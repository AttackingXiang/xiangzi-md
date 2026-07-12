use crate::{
    domain::{
        error::AppResult,
        models::{SearchMatch, SearchResponse, SearchResult},
    },
    infrastructure::workspace::ensure_allowed,
};
use std::{
    ffi::OsStr,
    fs,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::AppHandle;
use walkdir::WalkDir;

const MAX_FILES: usize = 3_000;
const MAX_RESULTS: usize = 400;
const MAX_MATCHES_PER_FILE: usize = 20;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES: &[&str] = &[".git", "node_modules", ".obsidian", ".vscode"];

#[derive(Clone, Default)]
pub struct SearchCancellation {
    generation: Arc<AtomicU64>,
}

pub struct SearchToken {
    generation: u64,
    current: Arc<AtomicU64>,
}

impl SearchCancellation {
    pub fn begin(&self) -> SearchToken {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        SearchToken {
            generation,
            current: Arc::clone(&self.generation),
        }
    }

    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
}

impl SearchToken {
    fn is_cancelled(&self) -> bool {
        self.current.load(Ordering::Acquire) != self.generation
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            ["md", "markdown", "mdown", "mkd", "mdx"]
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

pub fn search_in_folder(
    app: &AppHandle,
    root: &Path,
    query: &str,
    cancellation: &SearchToken,
) -> AppResult<SearchResponse> {
    ensure_allowed(app, root)?;
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchResponse {
            items: Vec::new(),
            scanned_files: 0,
            total_matches: 0,
            truncated: false,
            reason: None,
            cancelled: false,
        });
    }
    let needle = trimmed.to_lowercase();
    let mut results = Vec::new();
    let mut file_count = 0usize;
    let mut match_count = 0usize;
    let mut truncated = false;
    let mut reason = None;

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry
                .file_name()
                .to_str()
                .is_none_or(|name| !IGNORED_DIRECTORIES.contains(&name))
        })
        .filter_map(Result::ok)
    {
        if cancellation.is_cancelled() {
            return Ok(SearchResponse {
                items: Vec::new(),
                scanned_files: file_count,
                total_matches: match_count,
                truncated: false,
                reason: None,
                cancelled: true,
            });
        }
        if match_count >= MAX_RESULTS {
            truncated = true;
            reason = Some("match_limit".to_owned());
            break;
        }
        if file_count >= MAX_FILES {
            truncated = true;
            reason = Some("file_limit".to_owned());
            break;
        }
        if !entry.file_type().is_file() || !is_markdown(entry.path()) {
            continue;
        }
        file_count += 1;
        if entry
            .metadata()
            .is_ok_and(|metadata| metadata.len() > MAX_FILE_BYTES)
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        // Single allocation: lowercase the whole file once, then zip with original lines.
        let content_lower = content.to_lowercase();
        if !content_lower.contains(&needle) {
            continue;
        }

        let mut matches = Vec::new();
        let mut occurrence_index = 0usize;
        for (index, (line, lower_line)) in content.lines().zip(content_lower.lines()).enumerate() {
            if cancellation.is_cancelled() {
                return Ok(SearchResponse {
                    items: Vec::new(),
                    scanned_files: file_count,
                    total_matches: match_count,
                    truncated: false,
                    reason: None,
                    cancelled: true,
                });
            }
            let line_occurrences = lower_line.match_indices(&needle).count();
            if line_occurrences > 0 {
                matches.push(SearchMatch {
                    line_number: index + 1,
                    match_index: occurrence_index,
                    text: line.trim().chars().take(200).collect(),
                });
                match_count += 1;
                if matches.len() >= MAX_MATCHES_PER_FILE || match_count >= MAX_RESULTS {
                    if matches.len() >= MAX_MATCHES_PER_FILE {
                        truncated = true;
                        reason.get_or_insert_with(|| "per_file_limit".to_owned());
                    }
                    break;
                }
            }
            occurrence_index += line_occurrences;
        }
        if !matches.is_empty() {
            results.push(SearchResult {
                path: entry.path().to_string_lossy().into_owned(),
                name: entry.file_name().to_string_lossy().into_owned(),
                matches,
            });
        }
    }
    Ok(SearchResponse {
        items: results,
        scanned_files: file_count,
        total_matches: match_count,
        truncated,
        reason,
        cancelled: false,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_markdown, SearchCancellation};
    use std::path::Path;

    #[test]
    fn markdown_filter_is_case_insensitive() {
        assert!(is_markdown(Path::new("README.MD")));
        assert!(is_markdown(Path::new("page.markdown")));
        assert!(!is_markdown(Path::new("page.html")));
    }

    #[test]
    fn starting_or_cancelling_a_search_invalidates_the_previous_token() {
        let cancellation = SearchCancellation::default();
        let first = cancellation.begin();
        assert!(!first.is_cancelled());

        let second = cancellation.begin();
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());

        cancellation.cancel();
        assert!(second.is_cancelled());
    }
}
