use crate::domain::{
    error::{AppError, AppResult},
    models::{FileNode, FileVersion, Folder, NamedPath, OpenedFile},
};
use crate::infrastructure::settings::AppSettings;
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;
use walkdir::WalkDir;

pub use super::workspace_mutations::{create_dir, create_file, move_item, rename_item, trash_item};
pub use super::workspace_write::{write_binary_file, write_file};

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];
const IGNORED_DIRECTORIES: &[&str] = &[".git", "node_modules", ".DS_Store", ".obsidian", ".vscode"];
const MAX_LISTED_FILES: usize = 8_000;
pub(super) const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BINARY_READ_BYTES: u64 = 64 * 1024 * 1024;
pub(super) const MAX_BINARY_WRITE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Clone)]
pub struct WorkspaceVisibility {
    show_all_files: bool,
    hidden_paths: Vec<PathBuf>,
    /// Exact file/folder name matches hidden when show_all_files is true.
    hidden_name_patterns: Vec<String>,
}

impl WorkspaceVisibility {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            show_all_files: settings.show_all_files,
            hidden_paths: settings
                .hidden_workspace_paths
                .iter()
                .map(|p| {
                    let path = PathBuf::from(p);
                    path.canonicalize()
                        .unwrap_or_else(|_| path.components().collect())
                })
                .collect(),
            hidden_name_patterns: settings.hidden_name_patterns.clone(),
        }
    }

    fn is_hidden(&self, path: &Path) -> bool {
        let candidate = path
            .canonicalize()
            .unwrap_or_else(|_| path.components().collect::<PathBuf>());
        self.hidden_paths
            .iter()
            .any(|hidden| candidate == *hidden || candidate.starts_with(hidden))
    }

    fn matches_name_pattern(&self, path: &Path) -> bool {
        let name = path.file_name().and_then(OsStr::to_str).unwrap_or("");
        self.hidden_name_patterns
            .iter()
            .any(|p| p == name)
    }
}

#[derive(Clone, Default)]
pub struct DocumentWriteCoordinator {
    locks: Arc<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>>,
}

impl DocumentWriteCoordinator {
    pub fn with_path_lock<T>(
        &self,
        path: &Path,
        task: impl FnOnce() -> AppResult<T>,
    ) -> AppResult<T> {
        let key = path
            .canonicalize()
            .unwrap_or_else(|_| path.components().collect::<PathBuf>());
        let lock = {
            let mut locks = self
                .locks
                .lock()
                .map_err(|_| AppError::new("document_lock_failed", "文档保存锁不可用"))?;
            locks.retain(|_, lock| lock.strong_count() > 0);
            if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
                lock
            } else {
                let lock = Arc::new(Mutex::new(()));
                locks.insert(key, Arc::downgrade(&lock));
                lock
            }
        };
        let _guard = lock
            .lock()
            .map_err(|_| AppError::new("document_lock_failed", "文档保存锁不可用"))?;
        task()
    }
}

pub(super) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(super) fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_owned()
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

fn is_visible_text_file(path: &Path) -> bool {
    // Dotfiles (.gitignore, .env, etc.) are hidden by OS convention;
    // the user opts in to seeing them via show_all_files.
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or("");
    if name.starts_with('.') {
        return false;
    }
    is_markdown(path)
        || path
            .extension()
            .and_then(OsStr::to_str)
            .is_none_or(|extension| extension.eq_ignore_ascii_case("txt"))
}

fn modified_nanos(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

pub(super) fn file_version(path: &Path, bytes: &[u8]) -> AppResult<FileVersion> {
    let metadata = fs::metadata(path).map_err(|error| AppError::io("读取文件版本失败", error))?;
    Ok(FileVersion {
        size_bytes: bytes.len() as u64,
        modified_nanos: modified_nanos(&metadata),
        content_hash: blake3::hash(bytes).to_hex().to_string(),
    })
}

pub(super) fn read_limited(path: &Path, limit: u64, context: &str) -> AppResult<Vec<u8>> {
    let file = File::open(path).map_err(|error| AppError::io(context, error))?;
    let mut bytes = Vec::with_capacity(limit.min(1024 * 1024) as usize);
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| AppError::io(context, error))?;
    if bytes.len() as u64 > limit {
        return Err(AppError::new(
            "file_too_large",
            format!("文件超过读取上限（{} MB）", limit / (1024 * 1024)),
        ));
    }
    Ok(bytes)
}

fn is_ignored(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| IGNORED_DIRECTORIES.contains(&name))
}

pub fn ensure_allowed(app: &AppHandle, path: &Path) -> AppResult<()> {
    if app.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err(AppError::forbidden(path))
    }
}

pub fn ensure_write_allowed(app: &AppHandle, path: &Path) -> AppResult<()> {
    if app.fs_scope().is_allowed(path) {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "目标路径没有父目录"))?;
    ensure_allowed(app, parent)
}

pub fn read_dir_tree(
    app: &AppHandle,
    directory: &Path,
    visibility: &WorkspaceVisibility,
) -> AppResult<Vec<FileNode>> {
    ensure_allowed(app, directory)?;
    let entries = fs::read_dir(directory).map_err(|error| AppError::io("读取目录失败", error))?;
    let mut nodes = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| AppError::io("读取目录项失败", error))?;
        let path = entry.path();
        // Always skip explicitly hidden absolute paths.
        // In default mode, skip the hardcoded ignore list (node_modules, .git, etc.).
        // In show-all-files mode, skip user-configured name patterns instead.
        let skip = visibility.is_hidden(&path)
            || if visibility.show_all_files {
                visibility.matches_name_pattern(&path)
            } else {
                is_ignored(&path)
            };
        if skip {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| AppError::io("读取目录项类型失败", error))?;
        if file_type.is_dir() {
            nodes.push(FileNode {
                name: file_name(&path),
                path: path_string(&path),
                is_dir: true,
                openable: false,
                children: None,
            });
        } else if file_type.is_file() && (visibility.show_all_files || is_visible_text_file(&path))
        {
            nodes.push(FileNode {
                name: file_name(&path),
                path: path_string(&path),
                is_dir: false,
                openable: is_visible_text_file(&path),
                children: None,
            });
        }
    }

    nodes.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(nodes)
}

pub fn open_folder_path(
    app: &AppHandle,
    root: &Path,
    visibility: &WorkspaceVisibility,
) -> AppResult<Option<Folder>> {
    if !root.is_dir() {
        return Ok(None);
    }
    ensure_allowed(app, root)?;
    authorize_directory(app, root)?;
    Ok(Some(Folder {
        root: path_string(root),
        name: file_name(root),
        tree: read_dir_tree(app, root, visibility)?,
    }))
}

fn authorize_directory(app: &AppHandle, root: &Path) -> AppResult<()> {
    app.fs_scope()
        .allow_directory(root, true)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    Ok(())
}

pub fn open_containing_folder(
    app: &AppHandle,
    file_path: &Path,
    visibility: &WorkspaceVisibility,
) -> AppResult<Option<Folder>> {
    // The native file picker grants access to the selected file, not to all of
    // its siblings. Escalate only to that file's direct parent after proving
    // the selected file is already inside the persisted Tauri scope.
    ensure_allowed(app, file_path)?;
    if !file_path.is_file() {
        return Ok(None);
    }
    let parent = file_path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "文件路径没有父目录"))?;
    authorize_directory(app, parent)?;
    open_folder_path(app, parent, visibility)
}

pub fn read_file(app: &AppHandle, path: &Path) -> AppResult<OpenedFile> {
    ensure_allowed(app, path)?;
    let bytes = read_limited(path, MAX_DOCUMENT_BYTES, "读取文件失败")?;
    let content = String::from_utf8(bytes.clone()).map_err(|error| {
        AppError::new("file_encoding_invalid", format!("文件不是 UTF-8：{error}"))
    })?;
    let version = file_version(path, &bytes)?;
    Ok(OpenedFile {
        path: path_string(path),
        name: file_name(path),
        content,
        version,
    })
}

fn validate_binary_size(size: u64, requested_limit: u64) -> AppResult<u64> {
    let limit = requested_limit.clamp(1, MAX_BINARY_READ_BYTES);
    if size > limit {
        return Err(AppError::new(
            "binary_file_too_large",
            format!("资源超过读取上限（{} MB）", limit / (1024 * 1024)),
        ));
    }
    Ok(size)
}

pub fn read_binary_file(app: &AppHandle, path: &Path, max_bytes: u64) -> AppResult<Vec<u8>> {
    ensure_allowed(app, path)?;
    if !path.is_file() {
        return Err(AppError::new("invalid_file", "目标不是文件"));
    }
    let limit = max_bytes.clamp(1, MAX_BINARY_READ_BYTES);
    let bytes = read_limited(path, limit, "读取资源失败")?;
    validate_binary_size(bytes.len() as u64, limit)?;
    Ok(bytes)
}

pub fn list_files(app: &AppHandle, root: &Path) -> AppResult<Vec<NamedPath>> {
    ensure_allowed(app, root)?;
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_ignored(entry.path()))
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if entry.file_type().is_file() && is_markdown(path) {
            files.push(NamedPath {
                path: path_string(path),
                name: file_name(path),
            });
            if files.len() >= MAX_LISTED_FILES {
                break;
            }
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::{is_ignored, is_visible_text_file, validate_binary_size};
    use crate::domain::safe_name::validate_item_name;
    use std::path::Path;

    #[test]
    fn rejects_names_that_can_escape_the_parent_directory() {
        for name in ["", "  ", ".", "..", "../note.md", "a/b.md", "a\\b.md"] {
            assert!(validate_item_name(name).is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn accepts_regular_file_and_folder_names() {
        for name in ["笔记.md", "assets", "release-notes.mdx"] {
            assert!(validate_item_name(name).is_ok(), "rejected {name:?}");
        }
    }

    #[test]
    fn filters_tree_entries_consistently() {
        assert!(is_visible_text_file(Path::new("README.MD")));
        assert!(is_visible_text_file(Path::new("notes.txt")));
        assert!(!is_visible_text_file(Path::new("photo.png")));
        assert!(!is_visible_text_file(Path::new(".gitignore")));
        assert!(!is_visible_text_file(Path::new(".env")));
        assert!(is_ignored(Path::new("node_modules")));
        assert!(!is_ignored(Path::new("notes")));
    }

    #[test]
    fn bounds_binary_reads_by_the_requested_budget() {
        assert_eq!(
            validate_binary_size(1024, 2048).expect("within budget"),
            1024
        );
        assert!(validate_binary_size(4096, 2048).is_err());
        assert!(validate_binary_size(1, 0).is_ok());
    }
}
