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
    let apply_app = app.clone();
    let rollback_app = app.clone();
    store.set_transactional(
        &app,
        patch,
        move |settings| {
            if affects_menu {
                menu::install(&apply_app, &settings.language, &settings.shortcuts)?;
            }
            Ok(())
        },
        move |previous| {
            if affects_menu {
                let _ = menu::install(&rollback_app, &previous.language, &previous.shortcuts);
            }
        },
    )
}
