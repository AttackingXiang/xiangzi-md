use super::file_capabilities::is_known_text;
use serde::Serialize;
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

/// How many documents a single window drop may open.
///
/// `queue_open_path` only applies `MAX_PENDING_OPEN_PATHS` while the frontend
/// is still starting; once it is ready every path is emitted unconditionally,
/// which is fine for a file association (one path) but not for a drop, where
/// the OS hands over whatever the user selected in Finder/Explorer. Beyond the
/// tab flood, each accepted path permanently widens the fs and asset scopes,
/// and `tauri-plugin-persisted-scope` writes those entries to disk — so one
/// stray select-all drop would slow down every future launch.
const MAX_DROPPED_PATHS: usize = 32;

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
        queue_resolved_path(app, path);
    }
}

/// Grant access to an already-validated path and hand it to the frontend.
/// Split out so callers that have run `supported_path` themselves do not pay
/// for a second `is_file` stat — and cannot disagree with the first result if
/// the file disappears in between.
fn queue_resolved_path(app: &AppHandle, path: String) {
    let _ = app.fs_scope().allow_file(&path);
    let _ = app.asset_protocol_scope().allow_file(&path);
    app.state::<LifecycleState>().queue_open_path(app, path);
}

/// What a window drop resolved to, so the frontend can report it.
///
/// A drop that opens nothing must still say something: unlike the file picker
/// or a file association, the OS gives no feedback of its own, so a swallowed
/// drop is indistinguishable from a broken app.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
pub struct DropReport {
    /// Documents actually handed to the frontend.
    pub opened: usize,
    /// Paths the editor cannot open — images, folders, unknown types.
    pub rejected: Vec<String>,
    /// Whether openable paths were dropped beyond `MAX_DROPPED_PATHS`.
    pub truncated: bool,
}

/// Split dropped paths into what the editor can open and what it cannot,
/// capping the batch. Separated from the side effects so the batching rules
/// are testable without standing up a Tauri app.
fn classify_dropped_paths<'a>(
    raw_paths: impl IntoIterator<Item = &'a str>,
) -> (Vec<String>, DropReport) {
    let mut openable: Vec<String> = Vec::new();
    let mut report = DropReport::default();
    for raw in raw_paths {
        match supported_path(raw) {
            Some(path) => {
                // Finder hands over duplicates when the same file is selected
                // through an alias; opening it twice would just race the tab.
                if openable.contains(&path) {
                    continue;
                }
                if openable.len() == MAX_DROPPED_PATHS {
                    report.truncated = true;
                    continue;
                }
                openable.push(path);
            }
            None if report.rejected.len() < MAX_DROPPED_PATHS => {
                report.rejected.push(raw.to_owned())
            }
            None => {}
        }
    }
    report.opened = openable.len();
    (openable, report)
}

/// Open every dropped path the editor understands, returning what happened.
pub fn open_dropped_paths<'a>(
    app: &AppHandle,
    raw_paths: impl IntoIterator<Item = &'a str>,
) -> DropReport {
    let (openable, report) = classify_dropped_paths(raw_paths);
    for path in openable {
        queue_resolved_path(app, path);
    }
    report
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
    use super::{classify_dropped_paths, MAX_DROPPED_PATHS};
    use crate::infrastructure::file_capabilities::{MARKDOWN_EXTENSIONS, TEXT_EXTENSIONS};
    use std::{fs, path::Path};

    #[test]
    fn external_open_uses_the_full_editor_manifest() {
        assert!(MARKDOWN_EXTENSIONS.contains(&"mdown"));
        assert!(MARKDOWN_EXTENSIONS.contains(&"mdx"));
        assert!(TEXT_EXTENSIONS.contains(&"txt"));
        assert!(TEXT_EXTENSIONS.contains(&"html"));
        assert!(TEXT_EXTENSIONS.contains(&"tsx"));
    }

    fn write(dir: &Path, name: &str) -> String {
        let path = dir.join(name);
        fs::write(&path, "x").expect("write fixture");
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn dropping_editable_files_opens_them_and_reports_nothing_rejected() {
        let dir = tempfile::tempdir().expect("temp dir");
        let markdown = write(dir.path(), "note.md");
        // No extension still counts as text — the same rule the file tree uses.
        let license = write(dir.path(), "LICENSE");

        let (openable, report) = classify_dropped_paths([markdown.as_str(), license.as_str()]);
        assert_eq!(openable, vec![markdown, license]);
        assert_eq!(report.opened, 2);
        assert!(report.rejected.is_empty());
        assert!(!report.truncated);
    }

    #[test]
    fn images_folders_dotfiles_and_missing_paths_are_reported_as_rejected() {
        let dir = tempfile::tempdir().expect("temp dir");
        let image = write(dir.path(), "photo.png");
        let dotfile = write(dir.path(), ".env");
        let folder = dir.path().to_string_lossy().into_owned();
        let missing = dir.path().join("missing.md").to_string_lossy().into_owned();

        let (openable, report) = classify_dropped_paths([
            image.as_str(),
            dotfile.as_str(),
            folder.as_str(),
            missing.as_str(),
        ]);
        // Nothing opens, so the caller must be able to tell the user why
        // instead of leaving the drop silent.
        assert!(openable.is_empty());
        assert_eq!(report.opened, 0);
        assert_eq!(report.rejected, vec![image, dotfile, folder, missing]);
        assert!(!report.truncated);
    }

    #[test]
    fn a_large_drop_is_capped_and_flagged_as_truncated() {
        let dir = tempfile::tempdir().expect("temp dir");
        let paths: Vec<String> = (0..MAX_DROPPED_PATHS + 5)
            .map(|index| write(dir.path(), &format!("note-{index}.md")))
            .collect();

        let (openable, report) = classify_dropped_paths(paths.iter().map(String::as_str));
        assert_eq!(openable.len(), MAX_DROPPED_PATHS);
        assert_eq!(report.opened, MAX_DROPPED_PATHS);
        assert!(report.truncated);
    }

    #[test]
    fn the_same_path_dropped_twice_opens_one_document() {
        let dir = tempfile::tempdir().expect("temp dir");
        let markdown = write(dir.path(), "note.md");

        let (openable, report) = classify_dropped_paths([markdown.as_str(), markdown.as_str()]);
        assert_eq!(openable, vec![markdown]);
        assert_eq!(report.opened, 1);
        assert!(!report.truncated);
    }
}
