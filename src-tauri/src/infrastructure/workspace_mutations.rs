use super::workspace::{ensure_allowed, file_name, path_string};
use crate::domain::{
    error::{AppError, AppResult},
    models::{NamedPath, PathResult},
    safe_name::validate_item_name,
};
use std::{fs, fs::OpenOptions, path::Path};
use tauri::AppHandle;

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
