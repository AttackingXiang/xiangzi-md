use super::blocking;
use crate::{
    domain::{error::AppResult, models::SearchResult},
    infrastructure::search,
};
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub async fn search_in_folder(
    app: AppHandle,
    root: String,
    query: String,
) -> AppResult<Vec<SearchResult>> {
    blocking(move || search::search_in_folder(&app, &PathBuf::from(root), &query)).await
}
