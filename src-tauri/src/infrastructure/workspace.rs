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
        self.hidden_name_patterns.iter().any(|p| p == name)
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

/// 打开单个文档时，除文档所在目录外额外向上授权的祖先层数。
///
/// 单独打开一个文件时，应用会把该文件所在目录作为工作区一并打开——这一步走
/// macOS 文件选择器的 powerbox 授权，不弹系统权限框，且覆盖了文档同级/子目录。
/// 因此文档目录本身及其下的 assets/ 图片零弹窗即可显示。
///
/// 每额外向上授权「一层」目录（越出 powerbox 授权的文件夹、落入 ~/Documents 等
/// 受保护区），macOS 就会多弹一次「想访问文稿文件夹」——旧值 3 正是每次单文件
/// 打开弹三次的原因。取 1：只向上覆盖一层，兼容「文档被挪进子文件夹、图片仍在
/// 上级 assets/」这一最常见布局（此时恰好一次弹窗、图片正常），又把权限打扰降到
/// 最低。更深层级的图片请改用「打开文件夹」的方式，powerbox 会持久覆盖整棵树。
const DOC_ANCESTOR_AUTH_LEVELS: usize = 1;

/// 需要为某个文档授予读权限的目录集合：文档所在目录 + 向上 `levels` 层祖先。
fn document_scope_dirs(doc_path: &Path, levels: usize) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = doc_path.parent();
    for _ in 0..=levels {
        let Some(dir) = current else { break };
        dirs.push(dir.to_path_buf());
        match dir.parent() {
            Some(parent) if parent != dir => current = Some(parent),
            _ => break,
        }
    }
    dirs
}

/// 为文档所在目录授予读权限（fs + asset 协议 scope），使同目录、子目录里的
/// 图片能被渲染层加载。
///
/// 单独打开一个文件时，系统只授权了该文件本身；不放开其所在目录，指向文档
/// 同级/子目录的相对图片就会被协议层的 scope 校验拒绝而显示为裂图。范围严格
/// 限制在文档所在目录，不向上越界，以免触发 macOS 对「文稿」等目录的权限弹窗
/// （见 DOC_ANCESTOR_AUTH_LEVELS 说明）。
fn authorize_document_context(app: &AppHandle, doc_path: &Path) {
    for dir in document_scope_dirs(doc_path, DOC_ANCESTOR_AUTH_LEVELS) {
        let _ = app.fs_scope().allow_directory(&dir, true);
        let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    }
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
    // 授权文档所在目录及有限上层，使相对图片（含上层 assets/）可被渲染层读取。
    authorize_document_context(app, path);
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
    use super::{
        document_scope_dirs, is_ignored, is_visible_text_file, validate_binary_size,
        DOC_ANCESTOR_AUTH_LEVELS,
    };
    use crate::domain::safe_name::validate_item_name;
    use std::path::{Path, PathBuf};

    #[test]
    fn document_scope_covers_only_the_folder_and_one_ancestor() {
        // 默认层数为 1：文档所在目录 + 恰好一层父目录。前者由 powerbox 覆盖不弹窗，
        // 后者最多引发一次系统权限框，兼容「图片在上级 assets/」且把打扰降到最低。
        assert_eq!(DOC_ANCESTOR_AUTH_LEVELS, 1);
        let doc = Path::new("/note/xiangzi-note/科学上网/客户端/修改sim卡国家码.md");
        let dirs = document_scope_dirs(doc, DOC_ANCESTOR_AUTH_LEVELS);
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/note/xiangzi-note/科学上网/客户端"),
                PathBuf::from("/note/xiangzi-note/科学上网"),
            ]
        );
    }

    #[test]
    fn document_scope_walks_bounded_ancestors_when_asked() {
        // 函数本身仍支持向上取多层（用于潜在的其它调用场景），并在文件系统根停下。
        let dirs = document_scope_dirs(Path::new("/a/b/c.md"), 5);
        assert_eq!(dirs[0], PathBuf::from("/a/b"));
        assert!(dirs.contains(&PathBuf::from("/a")));
        assert_eq!(
            document_scope_dirs(Path::new("/a.md"), 3),
            vec![PathBuf::from("/")]
        );
    }

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
