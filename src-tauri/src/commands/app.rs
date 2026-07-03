use crate::domain::error::{AppError, AppResult};
use crate::infrastructure::lifecycle::LifecycleState;
use serde::Serialize;
use std::path::PathBuf;
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

/// Open a file using the OS default application.
/// Implemented via platform shell commands so no Tauri plugin scope is needed.
#[tauri::command]
pub fn open_with_default(path: String) -> AppResult<()> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err(AppError::new("file_not_found", "文件不存在"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| AppError::new("open_failed", e.to_string()))
    }
    #[cfg(target_os = "windows")]
    {
        // 不用 `cmd /C start` 是因为 cmd 会对路径里的 `%VAR%` 做环境变量展开，
        // 文件名恰好包含 `%...%` 时会被静默替换甚至打开错误路径。
        // explorer 直接接收路径参数交给系统关联程序打开，不经过 cmd 的字符串解析。
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| AppError::new("open_failed", e.to_string()))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| AppError::new("open_failed", e.to_string()))
    }
}
