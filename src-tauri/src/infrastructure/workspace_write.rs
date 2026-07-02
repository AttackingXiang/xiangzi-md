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
        match (expected_version, path.is_file()) {
            (Some(expected), true) => {
                let current =
                    super::workspace::read_limited(path, MAX_DOCUMENT_BYTES, "检查文件版本失败")?;
                if &file_version(path, &current)? != expected {
                    return Err(AppError::conflict(path));
                }
            }
            (Some(_), false) | (None, true) => return Err(AppError::conflict(path)),
            (None, false) => {}
        }
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
