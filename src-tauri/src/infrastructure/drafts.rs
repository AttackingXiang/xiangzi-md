use crate::domain::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{BufReader, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const MAX_DRAFT_CONTENT_BYTES: usize = 20 * 1024 * 1024;
const MAX_DRAFT_FILE_BYTES: u64 = MAX_DRAFT_CONTENT_BYTES as u64 + 64 * 1024;
const MAX_TOTAL_DRAFT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_DRAFTS: usize = 32;
const MAX_DRAFT_ID_LENGTH: usize = 128;
const MAX_DRAFT_NAME_CHARS: usize = 255;
const MAX_PATH_LENGTH: usize = 4096;
const PREVIEW_CHARS: usize = 160;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub path: Option<String>,
    pub name: String,
    pub content: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub id: String,
    pub path: Option<String>,
    pub name: String,
    pub preview: String,
    pub size_bytes: usize,
    pub updated_at: u64,
}

fn drafts_directory(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("drafts"))
        .map_err(|error| AppError::new("draft_path_failed", error.to_string()))
}

fn valid_draft_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_DRAFT_ID_LENGTH
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_draft_content_size(size: usize) -> bool {
    size <= MAX_DRAFT_CONTENT_BYTES
}

fn validate_draft(id: &str, path: Option<&str>, name: &str, content: &str) -> AppResult<()> {
    if !valid_draft_id(id) {
        return Err(AppError::new("draft_invalid", "草稿标识无效"));
    }
    if name.trim().is_empty()
        || name.chars().count() > MAX_DRAFT_NAME_CHARS
        || name.chars().any(char::is_control)
    {
        return Err(AppError::new("draft_invalid", "草稿名称无效"));
    }
    if path.is_some_and(|value| value.len() > MAX_PATH_LENGTH) {
        return Err(AppError::new("draft_invalid", "草稿路径过长"));
    }
    if !valid_draft_content_size(content.len()) {
        return Err(AppError::new(
            "draft_too_large",
            "草稿超过 20 MB，已停止保存快照",
        ));
    }
    Ok(())
}

fn draft_file(directory: &Path, id: &str) -> AppResult<PathBuf> {
    if !valid_draft_id(id) {
        return Err(AppError::new("draft_invalid", "草稿标识无效"));
    }
    Ok(directory.join(format!("{id}.json")))
}

fn read_draft_file(path: &Path) -> AppResult<Draft> {
    let metadata = fs::metadata(path).map_err(|error| AppError::io("读取草稿信息失败", error))?;
    if metadata.len() > MAX_DRAFT_FILE_BYTES {
        return Err(AppError::new("draft_too_large", "草稿文件超过读取上限"));
    }
    let file = File::open(path).map_err(|error| AppError::io("打开草稿失败", error))?;
    serde_json::from_reader(BufReader::new(file))
        .map_err(|error| AppError::new("draft_invalid", format!("草稿格式无效：{error}")))
}

fn preview(content: &str) -> String {
    let mut result = String::new();
    let mut pending_space = false;
    for character in content.chars() {
        if character.is_whitespace() {
            pending_space = !result.is_empty();
            continue;
        }
        if pending_space {
            result.push(' ');
            pending_space = false;
        }
        result.push(character);
        if result.chars().count() >= PREVIEW_CHARS {
            break;
        }
    }
    result
}

fn summary(draft: &Draft) -> DraftSummary {
    DraftSummary {
        id: draft.id.clone(),
        path: draft.path.clone(),
        name: draft.name.clone(),
        preview: preview(&draft.content),
        size_bytes: draft.content.len(),
        updated_at: draft.updated_at,
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn draft_files(directory: &Path) -> Vec<(PathBuf, u64, u64)> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
                .unwrap_or_default();
            Some((path, metadata.len(), modified))
        })
        .collect()
}

fn prune_drafts(directory: &Path) {
    let mut files = draft_files(directory);
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut total = files.iter().map(|(_, size, _)| size).sum::<u64>();
    while files.len() > MAX_DRAFTS || total > MAX_TOTAL_DRAFT_BYTES {
        let (path, size, _) = files.remove(0);
        let _ = fs::remove_file(path);
        total = total.saturating_sub(size);
    }
}

pub fn list_drafts(app: &AppHandle) -> AppResult<Vec<DraftSummary>> {
    let directory = drafts_directory(app)?;
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    prune_drafts(&directory);
    let mut drafts = draft_files(&directory)
        .into_iter()
        .filter_map(|(path, _, _)| {
            let draft = read_draft_file(&path).ok()?;
            validate_draft(
                &draft.id,
                draft.path.as_deref(),
                &draft.name,
                &draft.content,
            )
            .ok()?;
            (path.file_stem().and_then(|value| value.to_str()) == Some(draft.id.as_str()))
                .then_some(draft)
        })
        .map(|draft| summary(&draft))
        .collect::<Vec<_>>();
    drafts.sort_by_key(|draft| std::cmp::Reverse(draft.updated_at));
    drafts.truncate(MAX_DRAFTS);
    Ok(drafts)
}

pub fn read_draft(app: &AppHandle, id: &str) -> AppResult<Draft> {
    let path = draft_file(&drafts_directory(app)?, id)?;
    let draft = read_draft_file(&path)?;
    if draft.id != id {
        return Err(AppError::new("draft_invalid", "草稿标识不匹配"));
    }
    validate_draft(
        &draft.id,
        draft.path.as_deref(),
        &draft.name,
        &draft.content,
    )?;
    Ok(draft)
}

pub fn save_draft(
    app: &AppHandle,
    id: String,
    path: Option<String>,
    name: String,
    content: String,
) -> AppResult<DraftSummary> {
    validate_draft(&id, path.as_deref(), &name, &content)?;
    let directory = drafts_directory(app)?;
    fs::create_dir_all(&directory).map_err(|error| AppError::io("创建草稿目录失败", error))?;
    let target = draft_file(&directory, &id)?;
    let draft = Draft {
        id,
        path,
        name,
        content,
        updated_at: now_millis(),
    };
    let mut temporary = NamedTempFile::new_in(&directory)
        .map_err(|error| AppError::io("创建草稿临时文件失败", error))?;
    serde_json::to_writer(&mut temporary, &draft)
        .map_err(|error| AppError::new("draft_serialize_failed", error.to_string()))?;
    temporary
        .flush()
        .map_err(|error| AppError::io("写入草稿失败", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| AppError::io("同步草稿失败", error))?;
    temporary
        .persist(target)
        .map_err(|error| AppError::io("保存草稿失败", error.error))?;
    prune_drafts(&directory);
    Ok(summary(&draft))
}

pub fn delete_draft(app: &AppHandle, id: &str) -> AppResult<()> {
    let path = draft_file(&drafts_directory(app)?, id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::io("删除草稿失败", error)),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        preview, valid_draft_content_size, valid_draft_id, validate_draft, MAX_DRAFT_CONTENT_BYTES,
    };

    #[test]
    fn draft_ids_cannot_escape_the_internal_directory() {
        assert!(valid_draft_id("tab-123_abc"));
        assert!(!valid_draft_id("../settings"));
        assert!(!valid_draft_id("tab/123"));
        assert!(!valid_draft_id(""));
    }

    #[test]
    fn draft_payloads_are_bounded_and_named() {
        assert!(validate_draft("tab-1", Some("/notes/a.md"), "a.md", "draft").is_ok());
        assert!(validate_draft("tab-1", None, "\n", "draft").is_err());
        assert!(valid_draft_content_size(MAX_DRAFT_CONTENT_BYTES));
        assert!(!valid_draft_content_size(MAX_DRAFT_CONTENT_BYTES + 1));
    }

    #[test]
    fn preview_is_compact_and_unicode_safe() {
        assert_eq!(preview("  第一行\n\n第二行  "), "第一行 第二行");
    }
}
