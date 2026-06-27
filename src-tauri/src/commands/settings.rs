use crate::{
    domain::error::AppResult,
    infrastructure::settings::{AppSettings, SettingsPatch, SettingsStore},
};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_settings(app: AppHandle, store: State<'_, SettingsStore>) -> AppResult<AppSettings> {
    store.get(&app)
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    patch: SettingsPatch,
) -> AppResult<AppSettings> {
    store.set(&app, patch)
}
