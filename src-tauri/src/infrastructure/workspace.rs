use crate::domain::{
    error::{AppError, AppResult},
    models::{FileNode, Folder, NamedPath, OpenedFile, PathResult},
};
use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use tauri::AppHandle;
use tauri_plugin_fs::FsExt;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];
const IGNORED_DIRECTORIES: &[&str] = &[".git", "node_modules", ".DS_Store", ".obsidian", ".vscode"];
const MAX_LISTED_FILES: usize = 8_000;
const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn file_name(path: &Path) -> String {
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
    is_markdown(path)
        || path
            .extension()
            .and_then(OsStr::to_str)
            .is_none_or(|extension| extension.eq_ignore_ascii_case("txt"))
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

fn validate_item_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty()
        || matches!(name, "." | "..")
        || name.contains('/')
        || name.contains('\\')
        || Path::new(name).is_absolute()
    {
        return Err(AppError::new(
            "invalid_name",
            "名称不能为空或包含路径分隔符",
        ));
    }
    Ok(())
}

pub fn read_dir_tree(app: &AppHandle, directory: &Path) -> AppResult<Vec<FileNode>> {
    ensure_allowed(app, directory)?;
    let entries = fs::read_dir(directory).map_err(|error| AppError::io("读取目录失败", error))?;
    let mut nodes = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| AppError::io("读取目录项失败", error))?;
        let path = entry.path();
        if is_ignored(&path) {
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
                children: None,
            });
        } else if file_type.is_file() && is_visible_text_file(&path) {
            nodes.push(FileNode {
                name: file_name(&path),
                path: path_string(&path),
                is_dir: false,
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

pub fn open_folder_path(app: &AppHandle, root: &Path) -> AppResult<Option<Folder>> {
    if !root.is_dir() {
        return Ok(None);
    }
    ensure_allowed(app, root)?;
    Ok(Some(Folder {
        root: path_string(root),
        name: file_name(root),
        tree: read_dir_tree(app, root)?,
    }))
}

pub fn read_file(app: &AppHandle, path: &Path) -> AppResult<OpenedFile> {
    ensure_allowed(app, path)?;
    let metadata = fs::metadata(path).map_err(|error| AppError::io("读取文件信息失败", error))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::new(
            "file_too_large",
            "文件超过 20 MB，为避免内存占用过高已停止打开",
        ));
    }
    let content = fs::read_to_string(path).map_err(|error| AppError::io("读取文件失败", error))?;
    Ok(OpenedFile {
        path: path_string(path),
        name: file_name(path),
        content,
    })
}

pub fn write_file(app: &AppHandle, path: &Path, content: &str) -> AppResult<PathResult> {
    ensure_write_allowed(app, path)?;
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(AppError::new(
            "file_too_large",
            "文档超过 20 MB，为避免内存占用过高已停止保存",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "目标路径没有父目录"))?;
    fs::create_dir_all(parent).map_err(|error| AppError::io("创建目标目录失败", error))?;

    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|error| AppError::io("创建临时文件失败", error))?;
    temporary
        .write_all(content.as_bytes())
        .map_err(|error| AppError::io("写入临时文件失败", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| AppError::io("同步临时文件失败", error))?;
    temporary
        .persist(path)
        .map_err(|error| AppError::io("替换目标文件失败", error.error))?;

    Ok(PathResult {
        path: path_string(path),
    })
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

pub fn create_file(app: &AppHandle, directory: &Path, name: &str) -> AppResult<NamedPath> {
    validate_item_name(name)?;
    ensure_allowed(app, directory)?;
    let target = directory.join(name);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| AppError::io("新建文件失败", error))?;
    Ok(NamedPath {
        path: path_string(&target),
        name: name.to_owned(),
    })
}

pub fn create_dir(app: &AppHandle, directory: &Path, name: &str) -> AppResult<NamedPath> {
    validate_item_name(name)?;
    ensure_allowed(app, directory)?;
    let target = directory.join(name);
    fs::create_dir(&target).map_err(|error| AppError::io("新建文件夹失败", error))?;
    Ok(NamedPath {
        path: path_string(&target),
        name: name.to_owned(),
    })
}

pub fn rename_item(app: &AppHandle, old_path: &Path, new_name: &str) -> AppResult<NamedPath> {
    validate_item_name(new_name)?;
    ensure_allowed(app, old_path)?;
    let parent = old_path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "原路径没有父目录"))?;
    ensure_allowed(app, parent)?;
    let target = parent.join(new_name);
    if target.exists() {
        return Err(AppError::new("already_exists", "目标名称已存在"));
    }
    fs::rename(old_path, &target).map_err(|error| AppError::io("重命名失败", error))?;
    Ok(NamedPath {
        path: path_string(&target),
        name: new_name.to_owned(),
    })
}

pub fn move_item(app: &AppHandle, source: &Path, target_dir: &Path) -> AppResult<NamedPath> {
    ensure_allowed(app, source)?;
    ensure_allowed(app, target_dir)?;
    let name = file_name(source);
    if source.is_dir() && target_dir.starts_with(source) {
        return Err(AppError::new(
            "invalid_move",
            "不能把文件夹移动到它自己的子目录中",
        ));
    }
    let target = target_dir.join(&name);
    if target.exists() {
        return Err(AppError::new(
            "already_exists",
            format!("已存在同名项目：{name}"),
        ));
    }
    fs::rename(source, &target).map_err(|error| AppError::io("移动失败", error))?;
    Ok(NamedPath {
        path: path_string(&target),
        name,
    })
}

pub fn trash_item(app: &AppHandle, target: &Path) -> AppResult<PathResult> {
    ensure_allowed(app, target)?;
    trash::delete(target).map_err(|error| AppError::new("trash_failed", error.to_string()))?;
    Ok(PathResult {
        path: path_string(target),
    })
}

#[cfg(test)]
mod tests {
    use super::{is_ignored, is_visible_text_file, validate_item_name};
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
        assert!(is_ignored(Path::new("node_modules")));
        assert!(!is_ignored(Path::new("notes")));
    }
}
