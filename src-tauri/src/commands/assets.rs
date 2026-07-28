use super::blocking;
use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{remote_image, settings::SettingsStore, workspace},
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn read_remote_image(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    url: String,
) -> AppResult<tauri::ipc::Response> {
    if !store.get(&app)?.allow_remote_images {
        return Err(AppError::new(
            "remote_images_disabled",
            "远程图片加载尚未启用",
        ));
    }
    blocking(move || remote_image::fetch(&url))
        .await
        .map(tauri::ipc::Response::new)
}

/// dialog/persisted-scope 已经为用户选择的图片授予 fs 权限。这里先验证该既有
/// 授权，再补 asset scope，不能让任意 IPC 路径自行获得本地文件权限。
#[tauri::command]
pub async fn allow_background_image(app: AppHandle, path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(AppError::new("invalid_path", "路径必须是绝对路径"));
    }
    workspace::ensure_allowed(&app, &path)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    Ok(())
}
