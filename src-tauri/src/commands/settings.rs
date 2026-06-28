use crate::{
    domain::error::AppResult,
    infrastructure::{
        menu,
        settings::{AppSettings, SettingsPatch, SettingsStore},
    },
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
    let affects_menu = patch.affects_menu();
    let settings = store.set(&app, patch)?;
    if affects_menu {
        menu::install(&app, &settings.language, &settings.shortcuts)?;
    }
    Ok(settings)
}
