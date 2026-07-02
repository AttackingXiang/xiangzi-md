use super::blocking;
use crate::{
    domain::{
        error::AppResult,
        models::{FileNode, FileVersion, Folder, NamedPath, OpenedFile, PathResult, WriteResult},
    },
    infrastructure::{settings::SettingsStore, workspace},
};
use percent_encoding::percent_decode_str;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn open_folder_path(app: AppHandle, root: String) -> AppResult<Option<Folder>> {
    let settings = app.state::<SettingsStore>().get(&app)?;
    let visibility = workspace::WorkspaceVisibility::from_settings(&settings);
    blocking(move || workspace::open_folder_path(&app, &PathBuf::from(root), &visibility)).await
}

#[tauri::command]
pub async fn open_containing_folder(
    app: AppHandle,
    file_path: String,
) -> AppResult<Option<Folder>> {
    let settings = app.state::<SettingsStore>().get(&app)?;
    let visibility = workspace::WorkspaceVisibility::from_settings(&settings);
    blocking(move || {
        workspace::open_containing_folder(&app, &PathBuf::from(file_path), &visibility)
    })
    .await
}

#[tauri::command]
pub async fn read_file(app: AppHandle, path: String) -> AppResult<OpenedFile> {
    blocking(move || workspace::read_file(&app, &PathBuf::from(path))).await
}

#[tauri::command]
pub async fn read_binary_file(
    app: AppHandle,
    path: String,
    max_bytes: u64,
) -> AppResult<tauri::ipc::Response> {
    blocking(move || workspace::read_binary_file(&app, &PathBuf::from(path), max_bytes))
        .await
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn write_file(
    app: AppHandle,
    coordinator: State<'_, workspace::DocumentWriteCoordinator>,
    path: String,
    content: String,
    expected_version: Option<FileVersion>,
    force: bool,
) -> AppResult<WriteResult> {
    let coordinator = coordinator.inner().clone();
    blocking(move || {
        let path = PathBuf::from(path);
        coordinator.with_path_lock(&path, || {
            workspace::write_file(&app, &path, &content, expected_version.as_ref(), force)
        })
    })
    .await
}

#[tauri::command]
pub async fn write_binary_file(
    app: AppHandle,
    coordinator: State<'_, workspace::DocumentWriteCoordinator>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<PathResult> {
    let encoded_path = request
        .headers()
        .get("x-xmd-output-path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            crate::domain::error::AppError::new("output_path_missing", "缺少导出路径")
        })?;
    let path = percent_decode_str(encoded_path)
        .decode_utf8()
        .map_err(|_| {
            crate::domain::error::AppError::new("output_path_invalid", "导出路径编码无效")
        })?
        .into_owned();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => {
            return Err(crate::domain::error::AppError::new(
                "output_body_invalid",
                "导出文件必须使用二进制传输",
            ));
        }
    };
    let coordinator = coordinator.inner().clone();
    blocking(move || {
        let path = PathBuf::from(path);
        coordinator.with_path_lock(&path, || workspace::write_binary_file(&app, &path, &bytes))
    })
    .await
}

#[tauri::command]
pub async fn read_dir(app: AppHandle, path: String) -> AppResult<Vec<FileNode>> {
    let settings = app.state::<SettingsStore>().get(&app)?;
    let visibility = workspace::WorkspaceVisibility::from_settings(&settings);
    blocking(move || workspace::read_dir_tree(&app, &PathBuf::from(path), &visibility)).await
}

#[tauri::command]
pub async fn list_files(app: AppHandle, root: String) -> AppResult<Vec<NamedPath>> {
    blocking(move || workspace::list_files(&app, &PathBuf::from(root))).await
}

#[tauri::command]
pub async fn create_file(
    app: AppHandle,
    dir_path: String,
    file_name: String,
) -> AppResult<NamedPath> {
    blocking(move || workspace::create_file(&app, &PathBuf::from(dir_path), &file_name)).await
}

#[tauri::command]
pub async fn create_dir(app: AppHandle, dir_path: String, name: String) -> AppResult<NamedPath> {
    blocking(move || workspace::create_dir(&app, &PathBuf::from(dir_path), &name)).await
}

#[tauri::command]
pub async fn rename_item(
    app: AppHandle,
    old_path: String,
    new_name: String,
) -> AppResult<NamedPath> {
    blocking(move || workspace::rename_item(&app, &PathBuf::from(old_path), &new_name)).await
}

#[tauri::command]
pub async fn move_item(
    app: AppHandle,
    source_path: String,
    target_dir_path: String,
) -> AppResult<NamedPath> {
    blocking(move || {
        workspace::move_item(
            &app,
            &PathBuf::from(source_path),
            &PathBuf::from(target_dir_path),
        )
    })
    .await
}

#[tauri::command]
pub async fn trash_item(app: AppHandle, target_path: String) -> AppResult<PathResult> {
    blocking(move || workspace::trash_item(&app, &PathBuf::from(target_path))).await
}
