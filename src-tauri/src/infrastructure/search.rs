use crate::{
    domain::{
        error::AppResult,
        models::{SearchMatch, SearchResult},
    },
    infrastructure::workspace::ensure_allowed,
};
use std::{ffi::OsStr, fs, path::Path};
use tauri::AppHandle;
use walkdir::WalkDir;

const MAX_FILES: usize = 3_000;
const MAX_RESULTS: usize = 400;
const MAX_MATCHES_PER_FILE: usize = 20;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES: &[&str] = &[".git", "node_modules", ".obsidian", ".vscode"];

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            ["md", "markdown", "mdown", "mkd", "mdx"]
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

pub fn search_in_folder(app: &AppHandle, root: &Path, query: &str) -> AppResult<Vec<SearchResult>> {
    ensure_allowed(app, root)?;
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let needle = trimmed.to_lowercase();
    let mut results = Vec::new();
    let mut file_count = 0usize;
    let mut match_count = 0usize;

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
        if match_count >= MAX_RESULTS || file_count >= MAX_FILES {
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
        if !content.to_lowercase().contains(&needle) {
            continue;
        }

        let mut matches = Vec::new();
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                matches.push(SearchMatch {
                    line_number: index + 1,
                    text: line.trim().chars().take(200).collect(),
                });
                match_count += 1;
                if matches.len() >= MAX_MATCHES_PER_FILE || match_count >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matches.is_empty() {
            results.push(SearchResult {
                path: entry.path().to_string_lossy().into_owned(),
                name: entry.file_name().to_string_lossy().into_owned(),
                matches,
            });
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::is_markdown;
    use std::path::Path;

    #[test]
    fn markdown_filter_is_case_insensitive() {
        assert!(is_markdown(Path::new("README.MD")));
        assert!(is_markdown(Path::new("page.markdown")));
        assert!(!is_markdown(Path::new("page.html")));
    }
}
