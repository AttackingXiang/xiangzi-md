use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};

const SUPPORTED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx", "txt"];

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
            if !pending.contains(&path) {
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
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    (path.is_file() && SUPPORTED_EXTENSIONS.contains(&extension.as_str()))
        .then(|| path.to_string_lossy().into_owned())
}

pub fn queue_supported_arguments(app: &AppHandle, arguments: impl IntoIterator<Item = String>) {
    let state = app.state::<LifecycleState>();
    for argument in arguments {
        if let Some(path) = supported_path(&argument) {
            state.queue_open_path(app, path);
        }
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
    use super::SUPPORTED_EXTENSIONS;

    #[test]
    fn supported_extensions_cover_legacy_formats() {
        assert!(SUPPORTED_EXTENSIONS.contains(&"markdown"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"mdx"));
        assert!(SUPPORTED_EXTENSIONS.contains(&"txt"));
        assert!(!SUPPORTED_EXTENSIONS.contains(&"html"));
    }
}
