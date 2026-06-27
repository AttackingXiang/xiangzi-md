use super::blocking;
use crate::{
    domain::{
        error::AppResult,
        models::{FileNode, Folder, NamedPath, OpenedFile, PathResult},
    },
    infrastructure::workspace,
};
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub async fn open_folder_path(app: AppHandle, root: String) -> AppResult<Option<Folder>> {
    blocking(move || workspace::open_folder_path(&app, &PathBuf::from(root))).await
}

#[tauri::command]
pub async fn read_file(app: AppHandle, path: String) -> AppResult<OpenedFile> {
    blocking(move || workspace::read_file(&app, &PathBuf::from(path))).await
}

#[tauri::command]
pub async fn write_file(app: AppHandle, path: String, content: String) -> AppResult<PathResult> {
    blocking(move || workspace::write_file(&app, &PathBuf::from(path), &content)).await
}

#[tauri::command]
pub async fn read_dir(app: AppHandle, path: String) -> AppResult<Vec<FileNode>> {
    blocking(move || workspace::read_dir_tree(&app, &PathBuf::from(path))).await
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
