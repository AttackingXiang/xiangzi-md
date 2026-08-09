use super::file_capabilities::is_known_text;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

const MAX_PENDING_OPEN_PATHS: usize = 32;

pub struct LifecycleState {
    frontend_ready: AtomicBool,
    quit_confirmed: AtomicBool,
    pending_open_paths: Mutex<Vec<String>>,
    zoom: Mutex<f64>,
}

impl Default for LifecycleState {
    fn default() -> Self {
        Self {
            frontend_ready: AtomicBool::new(false),
            quit_confirmed: AtomicBool::new(false),
            pending_open_paths: Mutex::new(Vec::new()),
            zoom: Mutex::new(1.0),
        }
    }
}

impl LifecycleState {
    pub fn is_quit_confirmed(&self) -> bool {
        self.quit_confirmed.load(Ordering::Acquire)
    }

    pub fn confirm_quit(&self) {
        self.quit_confirmed.store(true, Ordering::Release);
    }

    pub fn mark_frontend_ready(&self, app: &AppHandle) {
        self.frontend_ready.store(true, Ordering::Release);
        let paths = self
            .pending_open_paths
            .lock()
            .map(|mut pending| pending.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();
        for path in paths {
            let _ = app.emit("open-path", path);
        }
    }

    pub fn queue_open_path(&self, app: &AppHandle, path: String) {
        if self.frontend_ready.load(Ordering::Acquire) {
            let _ = app.emit("open-path", path);
        } else if let Ok(mut pending) = self.pending_open_paths.lock() {
            if pending.len() < MAX_PENDING_OPEN_PATHS && !pending.contains(&path) {
                pending.push(path);
            }
        }
    }

    pub fn update_zoom(&self, delta: f64) -> f64 {
        let mut zoom = self.zoom.lock().unwrap_or_else(|error| error.into_inner());
        if delta == 0.0 {
            *zoom = 1.0;
        } else {
            *zoom = (*zoom + delta).clamp(0.5, 2.0);
        }
        *zoom
    }
}

pub fn supported_path(raw: &str) -> Option<String> {
    let path = Path::new(raw);
    (path.is_file() && is_known_text(path)).then(|| path.to_string_lossy().into_owned())
}

pub fn queue_supported_arguments(app: &AppHandle, arguments: impl IntoIterator<Item = String>) {
    for argument in arguments {
        queue_supported_path(app, &argument);
    }
}

pub fn queue_supported_path(app: &AppHandle, raw: &str) {
    if let Some(path) = supported_path(raw) {
        let _ = app.fs_scope().allow_file(&path);
        let _ = app.asset_protocol_scope().allow_file(&path);
        app.state::<LifecycleState>().queue_open_path(app, path);
    }
}

pub fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use crate::infrastructure::file_capabilities::{MARKDOWN_EXTENSIONS, TEXT_EXTENSIONS};

    #[test]
    fn external_open_uses_the_full_editor_manifest() {
        assert!(MARKDOWN_EXTENSIONS.contains(&"mdown"));
        assert!(MARKDOWN_EXTENSIONS.contains(&"mdx"));
        assert!(TEXT_EXTENSIONS.contains(&"txt"));
        assert!(TEXT_EXTENSIONS.contains(&"html"));
        assert!(TEXT_EXTENSIONS.contains(&"tsx"));
    }
}
