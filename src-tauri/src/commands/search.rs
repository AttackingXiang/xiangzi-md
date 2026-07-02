use super::blocking;
use crate::{
    domain::{error::AppResult, models::SearchResponse},
    infrastructure::search::{self, SearchCancellation},
};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn search_in_folder(
    app: AppHandle,
    cancellation: State<'_, SearchCancellation>,
    root: String,
    query: String,
) -> AppResult<SearchResponse> {
    let token = cancellation.begin();
    blocking(move || search::search_in_folder(&app, &PathBuf::from(root), &query, &token)).await
}

#[tauri::command]
pub fn cancel_search(cancellation: State<'_, SearchCancellation>) {
    cancellation.cancel();
}
