use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(crate) const SETTINGS_SCHEMA_VERSION: u32 = 4;
pub(crate) const MAX_RECENT_ITEMS: usize = 15;
pub(crate) const MAX_FAVORITES: usize = 32;
pub(crate) const MAX_SESSION_FILES: usize = 12;
pub(crate) const MAX_ASSET_SEARCH_PATHS: usize = 32;
pub(crate) const MAX_HIDDEN_WORKSPACE_PATHS: usize = 64;
pub(crate) const MAX_SHORTCUT_OVERRIDES: usize = 64;
pub(crate) const MAX_PATH_LENGTH: usize = 4096;
pub(crate) const MAX_FAVORITE_LABEL_CHARS: usize = 80;

pub(crate) const SHORTCUT_ACTIONS: &[&str] = &[
    "new-file",
    "open-file",
    "open-folder",
    "save",
    "save-as",
    "close-tab",
    "find",
    "search-in-folder",
    "select-all",
    "command-palette",
    "toggle-sidebar",
    "toggle-outline",
    "toggle-source",
    "toggle-focus",
    "toggle-typewriter",
    "open-settings",
    "show-shortcuts",
    "heading-1",
    "heading-2",
    "heading-3",
    "heading-4",
    "heading-5",
    "heading-6",
    "paragraph",
    "bold",
    "italic",
    "inline-code",
    "quote",
    "code-block",
    "bullet-list",
    "ordered-list",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettings {
    pub folder: Option<String>,
    pub open_files: Vec<String>,
    pub active_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub attachment_mode: String,
    pub attachment_folder: String,
    pub image_max_width: u32,
    pub language: String,
    pub theme: String,
    pub editor_width: String,
    pub custom_css_path: String,
    pub heading_number: bool,
    pub auto_save: bool,
    pub check_updates_on_startup: bool,
    pub shortcuts: BTreeMap<String, String>,
    pub recent_files: Vec<String>,
    pub recent_folders: Vec<String>,
    pub favorites: Vec<String>,
    pub favorites_collapsed: bool,
    pub favorite_labels: BTreeMap<String, String>,
    pub session: SessionSettings,
    pub hide_attachment_folders: bool,
    pub asset_search_paths: Vec<String>,
    pub show_all_files: bool,
    pub hidden_workspace_paths: Vec<String>,
    pub allow_remote_images: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            attachment_mode: "subfolder".into(),
            attachment_folder: "assets".into(),
            image_max_width: 800,
            language: "zh".into(),
            theme: "system".into(),
            editor_width: "full".into(),
            custom_css_path: String::new(),
            heading_number: false,
            auto_save: false,
            check_updates_on_startup: true,
            shortcuts: BTreeMap::new(),
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
            favorites: Vec::new(),
            favorites_collapsed: false,
            favorite_labels: BTreeMap::new(),
            session: SessionSettings::default(),
            hide_attachment_folders: false,
            asset_search_paths: Vec::new(),
            show_all_files: false,
            hidden_workspace_paths: Vec::new(),
            allow_remote_images: false,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub attachment_mode: Option<String>,
    pub attachment_folder: Option<String>,
    pub image_max_width: Option<u32>,
    pub language: Option<String>,
    pub theme: Option<String>,
    pub editor_width: Option<String>,
    pub custom_css_path: Option<String>,
    pub heading_number: Option<bool>,
    pub auto_save: Option<bool>,
    pub check_updates_on_startup: Option<bool>,
    pub shortcuts: Option<BTreeMap<String, String>>,
    pub recent_files: Option<Vec<String>>,
    pub recent_folders: Option<Vec<String>>,
    pub favorites: Option<Vec<String>>,
    pub favorites_collapsed: Option<bool>,
    pub favorite_labels: Option<BTreeMap<String, String>>,
    pub session: Option<SessionSettings>,
    pub hide_attachment_folders: Option<bool>,
    pub asset_search_paths: Option<Vec<String>>,
    pub show_all_files: Option<bool>,
    pub hidden_workspace_paths: Option<Vec<String>>,
    pub allow_remote_images: Option<bool>,
}

impl SettingsPatch {
    pub fn affects_menu(&self) -> bool {
        self.language.is_some() || self.shortcuts.is_some()
    }
}
