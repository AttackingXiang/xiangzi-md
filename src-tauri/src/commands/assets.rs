use super::blocking;
use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{remote_image, settings::SettingsStore},
};
use tauri::{AppHandle, State};

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
