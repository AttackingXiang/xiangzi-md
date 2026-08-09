use super::blocking;
use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{remote_image, settings::SettingsStore, workspace},
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

fn validate_asset_search_path_shape(path: &std::path::Path) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::new("invalid_path", "路径必须是绝对路径"));
    }
    if path.parent().is_none() {
        return Err(AppError::new(
            "asset_scope_too_broad",
            "不能把文件系统根目录设为资源目录",
        ));
    }
    Ok(())
}

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

/// Extends only the asset protocol after the native folder picker (and the
/// persisted fs scope on later launches) has already authorized this exact
/// directory. Settings strings alone can never grant filesystem access.
#[tauri::command]
pub async fn authorize_asset_search_directory(app: AppHandle, path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    validate_asset_search_path_shape(&path)?;
    workspace::ensure_allowed(&app, &path)?;
    if !path.is_dir() {
        return Err(AppError::new("invalid_directory", "资源路径必须是文件夹"));
    }
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_asset_search_path_shape;
    use std::path::Path;

    #[test]
    fn asset_search_scope_requires_a_bounded_absolute_directory() {
        #[cfg(windows)]
        let root = Path::new(r"C:\");
        #[cfg(not(windows))]
        let root = Path::new("/");
        let valid_directory = root.join("notes").join("images");

        assert!(validate_asset_search_path_shape(Path::new("images")).is_err());
        assert!(validate_asset_search_path_shape(root).is_err());
        assert!(validate_asset_search_path_shape(&valid_directory).is_ok());
    }
}
