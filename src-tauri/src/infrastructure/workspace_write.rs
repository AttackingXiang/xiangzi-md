use super::workspace::{
    ensure_write_allowed, file_version, path_string, MAX_BINARY_WRITE_BYTES, MAX_DOCUMENT_BYTES,
};
use crate::domain::{
    error::{AppError, AppResult},
    models::{FileVersion, PathResult, WriteResult},
};
use std::{
    fs::{self, File},
    io::Write,
    path::Path,
};
use tauri::AppHandle;
use tempfile::NamedTempFile;

#[cfg(unix)]
fn copy_extended_attributes(source: &Path, target: &Path) -> AppResult<()> {
    for name in xattr::list(source).map_err(|error| AppError::io("读取扩展属性失败", error))?
    {
        if let Some(value) =
            xattr::get(source, &name).map_err(|error| AppError::io("读取扩展属性失败", error))?
        {
            xattr::set(target, &name, &value)
                .map_err(|error| AppError::io("保留扩展属性失败", error))?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn copy_extended_attributes(_source: &Path, _target: &Path) -> AppResult<()> {
    Ok(())
}

fn sync_parent_directory(parent: &Path) -> AppResult<()> {
    #[cfg(unix)]
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| AppError::io("同步目标目录失败", error))?;
    Ok(())
}

/// Verifies that the on-disk file matches `expected_version` before overwriting.
/// Extracted so the conflict-detection logic can be tested independently of the
/// Tauri AppHandle scope check.
fn check_version_conflict(path: &Path, expected_version: Option<&FileVersion>) -> AppResult<()> {
    match (expected_version, path.is_file()) {
        (Some(expected), true) => {
            let current =
                super::workspace::read_limited(path, MAX_DOCUMENT_BYTES, "检查文件版本失败")?;
            // Compare content, not the whole version: a "conflict" means the
            // bytes on disk differ from what our edits were based on. The
            // modified-time (and thus the full FileVersion) can change without
            // any content change — iCloud/Dropbox sync, backups, or a metadata
            // touch on the file — and must not be reported as an external edit.
            if file_version(path, &current)?.content_hash != expected.content_hash {
                return Err(AppError::conflict(path));
            }
            Ok(())
        }
        (Some(_), false) | (None, true) => Err(AppError::conflict(path)),
        (None, false) => Ok(()),
    }
}

pub fn write_file(
    app: &AppHandle,
    path: &Path,
    content: &str,
    expected_version: Option<&FileVersion>,
    force: bool,
) -> AppResult<WriteResult> {
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

    let original_metadata = fs::metadata(path).ok();
    if !force {
        check_version_conflict(path, expected_version)?;
    }

    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|error| AppError::io("创建临时文件失败", error))?;
    temporary
        .write_all(content.as_bytes())
        .map_err(|error| AppError::io("写入临时文件失败", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| AppError::io("同步临时文件失败", error))?;
    if let Some(metadata) = &original_metadata {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| AppError::io("保留文件权限失败", error))?;
        copy_extended_attributes(path, temporary.path())?;
    }
    temporary
        .persist(path)
        .map_err(|error| AppError::io("替换目标文件失败", error.error))?;
    sync_parent_directory(parent)?;

    Ok(WriteResult {
        path: path_string(path),
        version: file_version(path, content.as_bytes())?,
    })
}

pub fn write_binary_file(app: &AppHandle, path: &Path, bytes: &[u8]) -> AppResult<PathResult> {
    ensure_write_allowed(app, path)?;
    if bytes.len() as u64 > MAX_BINARY_WRITE_BYTES {
        return Err(AppError::new(
            "file_too_large",
            "导出文件超过 128 MB，已停止写入",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "目标路径没有父目录"))?;
    fs::create_dir_all(parent).map_err(|error| AppError::io("创建目标目录失败", error))?;
    let original_metadata = fs::metadata(path).ok();
    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|error| AppError::io("创建临时文件失败", error))?;
    temporary
        .write_all(bytes)
        .map_err(|error| AppError::io("写入临时文件失败", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| AppError::io("同步临时文件失败", error))?;
    if let Some(metadata) = &original_metadata {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| AppError::io("保留文件权限失败", error))?;
        copy_extended_attributes(path, temporary.path())?;
    }
    temporary
        .persist(path)
        .map_err(|error| AppError::io("替换目标文件失败", error.error))?;
    sync_parent_directory(parent)?;
    Ok(PathResult {
        path: path_string(path),
    })
}

#[cfg(test)]
mod tests {
    use super::{check_version_conflict, file_version};
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn accepts_matching_version_for_unchanged_file() {
        let mut file = NamedTempFile::new().expect("temp file");
        file.write_all(b"hello").expect("write");
        let path = file.path();
        let version = file_version(path, b"hello").expect("version");
        assert!(check_version_conflict(path, Some(&version)).is_ok());
    }

    #[test]
    fn detects_conflict_when_file_content_changes() {
        let mut file = NamedTempFile::new().expect("temp file");
        file.write_all(b"original").expect("write");
        // Clone path before the mutable write_all to release the immutable borrow.
        let path = file.path().to_path_buf();
        let stale = file_version(&path, b"original").expect("version");
        file.write_all(b" appended").expect("append");
        assert!(check_version_conflict(&path, Some(&stale)).is_err());
    }

    #[test]
    fn no_conflict_when_only_modified_time_changes() {
        use std::fs;
        let file = NamedTempFile::new().expect("temp file");
        let path = file.path().to_path_buf();
        fs::write(&path, b"same content").expect("write");
        let version = file_version(&path, b"same content").expect("version");
        // Rewriting identical bytes bumps the file's modified time (as iCloud or
        // a backup would) without changing content — this must not conflict.
        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(&path, b"same content").expect("rewrite");
        assert_ne!(
            file_version(&path, b"same content")
                .expect("version2")
                .modified_nanos,
            version.modified_nanos,
            "precondition: rewrite should change mtime",
        );
        assert!(check_version_conflict(&path, Some(&version)).is_ok());
    }

    #[test]
    fn conflict_when_expected_version_given_but_file_absent() {
        use crate::domain::models::FileVersion;
        let absent = std::path::Path::new("/tmp/xmd-test-nonexistent-file-abc123.md");
        let version = FileVersion {
            size_bytes: 0,
            modified_nanos: 0,
            content_hash: String::new(),
        };
        assert!(check_version_conflict(absent, Some(&version)).is_err());
    }

    #[test]
    fn no_conflict_for_new_file_with_no_expected_version() {
        let absent = std::path::Path::new("/tmp/xmd-test-nonexistent-new-file.md");
        assert!(check_version_conflict(absent, None).is_ok());
    }
}
