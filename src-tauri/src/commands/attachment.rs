use super::blocking;
use crate::{
    domain::error::AppResult,
    infrastructure::{attachment, settings::SettingsStore},
};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentResult {
    rel_path: String,
}

#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    doc_dir: String,
    doc_name: String,
    vault_root: Option<String>,
    file_name: String,
    data: Vec<u8>,
) -> AppResult<AttachmentResult> {
    let settings = store.get(&app)?;
    blocking(move || {
        let vault = vault_root.as_ref().map(PathBuf::from);
        attachment::save_attachment(
            &app,
            &settings,
            &PathBuf::from(doc_dir),
            &doc_name,
            vault.as_deref(),
            &file_name,
            &data,
        )
        .map(|rel_path| AttachmentResult { rel_path })
    })
    .await
}
