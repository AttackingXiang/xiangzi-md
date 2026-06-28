use crate::infrastructure::lifecycle::LifecycleState;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    migration_status: &'static str,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Xiangzi MD",
        version: env!("CARGO_PKG_VERSION"),
        migration_status: "tauri-1.0",
    }
}

#[tauri::command]
pub fn frontend_ready(app: AppHandle, lifecycle: State<'_, LifecycleState>) {
    lifecycle.mark_frontend_ready(&app);
}

#[tauri::command]
pub fn quit_confirmed(app: AppHandle, lifecycle: State<'_, LifecycleState>) {
    lifecycle.confirm_quit();
    app.exit(0);
}
