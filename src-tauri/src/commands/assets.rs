use super::blocking;
use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{remote_image, settings::SettingsStore},
};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

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

/// 用户通过原生文件选择器挑选了一张背景图片后，把它加入 fs 授权范围，使
/// read_binary_file 之后能读到这个既不在 vault 内、也未随文档打开授权的
/// 任意路径。`tauri_plugin_persisted_scope` 会把这次授权写盘，下次启动无需
/// 重新授权。
#[tauri::command]
pub async fn allow_background_image(app: AppHandle, path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(AppError::new("invalid_path", "路径必须是绝对路径"));
    }
    app.fs_scope()
        .allow_file(&path)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    Ok(())
}
