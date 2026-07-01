use super::blocking;
use crate::{
    domain::error::AppResult,
    infrastructure::drafts::{self, Draft, DraftSummary},
};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_drafts(app: AppHandle) -> AppResult<Vec<DraftSummary>> {
    blocking(move || drafts::list_drafts(&app)).await
}

#[tauri::command]
pub async fn read_draft(app: AppHandle, id: String) -> AppResult<Draft> {
    blocking(move || drafts::read_draft(&app, &id)).await
}

#[tauri::command]
pub async fn save_draft(
    app: AppHandle,
    id: String,
    path: Option<String>,
    name: String,
    content: String,
) -> AppResult<DraftSummary> {
    blocking(move || drafts::save_draft(&app, id, path, name, content)).await
}

#[tauri::command]
pub async fn delete_draft(app: AppHandle, id: String) -> AppResult<()> {
    blocking(move || drafts::delete_draft(&app, &id)).await
}
