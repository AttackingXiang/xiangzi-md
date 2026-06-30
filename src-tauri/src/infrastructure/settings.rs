use crate::domain::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;
use tempfile::NamedTempFile;

const SETTINGS_SCHEMA_VERSION: u32 = 2;
const MAX_RECENT_ITEMS: usize = 15;
const MAX_FAVORITES: usize = 32;
const MAX_SESSION_FILES: usize = 12;
const MAX_ASSET_SEARCH_PATHS: usize = 32;
const MAX_SHORTCUT_OVERRIDES: usize = 64;
const MAX_PATH_LENGTH: usize = 4096;

const SHORTCUT_ACTIONS: &[&str] = &[
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
    pub session: SessionSettings,
    pub hide_attachment_folders: bool,
    pub asset_search_paths: Vec<String>,
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
            session: SessionSettings::default(),
            hide_attachment_folders: false,
            asset_search_paths: Vec::new(),
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
    pub session: Option<SessionSettings>,
    pub hide_attachment_folders: Option<bool>,
    pub asset_search_paths: Option<Vec<String>>,
}

impl SettingsPatch {
    pub fn affects_menu(&self) -> bool {
        self.language.is_some() || self.shortcuts.is_some()
    }
}

#[derive(Default)]
pub struct SettingsStore {
    cache: Mutex<Option<AppSettings>>,
}

impl SettingsStore {
    pub fn get(&self, app: &AppHandle) -> AppResult<AppSettings> {
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| AppError::new("settings_lock_failed", "设置缓存不可用"))?;
        if let Some(settings) = guard.as_ref() {
            return Ok(settings.clone());
        }

        let settings = load_settings(app)?;
        authorize_settings_paths(app, &settings);
        *guard = Some(settings.clone());
        Ok(settings)
    }

    pub fn set(&self, app: &AppHandle, patch: SettingsPatch) -> AppResult<AppSettings> {
        // Keep the cache lock for the full read-modify-write transaction. Tauri
        // commands can run concurrently; releasing it between get and write
        // allowed unrelated patches (for example recents and session state) to
        // overwrite each other.
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| AppError::new("settings_lock_failed", "设置缓存不可用"))?;
        let mut settings = match guard.as_ref() {
            Some(settings) => settings.clone(),
            None => load_settings(app)?,
        };
        apply_patch(&mut settings, patch);
        validate_settings(&settings)?;
        limit_collections(&mut settings);
        settings.schema_version = SETTINGS_SCHEMA_VERSION;
        write_settings(&settings_file(app)?, &settings)?;
        authorize_settings_paths(app, &settings);
        *guard = Some(settings.clone());
        Ok(settings)
    }
}

fn load_settings(app: &AppHandle) -> AppResult<AppSettings> {
    let settings_path = settings_file(app)?;
    let (mut settings, source_schema_version, imported) = if settings_path.is_file() {
        let loaded = read_settings(&settings_path)?;
        (loaded.settings, loaded.schema_version, false)
    } else if let Some(legacy) = legacy_settings_file().filter(|path| path.is_file()) {
        let loaded = read_settings(&legacy)?;
        (loaded.settings, loaded.schema_version, true)
    } else {
        (AppSettings::default(), SETTINGS_SCHEMA_VERSION, true)
    };
    migrate_settings(&mut settings, source_schema_version)?;
    sanitize_loaded_settings(&mut settings);
    if imported || source_schema_version < SETTINGS_SCHEMA_VERSION {
        write_settings(&settings_path, &settings)?;
    }
    Ok(settings)
}

fn settings_file(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| AppError::new("settings_path_failed", error.to_string()))
}

fn legacy_settings_file() -> Option<PathBuf> {
    dirs::data_dir().map(|directory| directory.join("Xiangzi MD").join("settings.json"))
}

struct LoadedSettings {
    settings: AppSettings,
    schema_version: u32,
}

fn read_settings(path: &Path) -> AppResult<LoadedSettings> {
    let raw = fs::read_to_string(path).map_err(|error| AppError::io("读取设置失败", error))?;
    parse_settings(&raw)
}

fn parse_settings(raw: &str) -> AppResult<LoadedSettings> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| AppError::new("settings_invalid", format!("设置格式无效：{error}")))?;
    let schema_version = match value.get("schemaVersion") {
        None => 0,
        Some(value) => value
            .as_u64()
            .and_then(|version| u32::try_from(version).ok())
            .ok_or_else(|| AppError::new("settings_invalid", "设置版本号无效"))?,
    };
    let mut settings: AppSettings = serde_json::from_value(value)
        .map_err(|error| AppError::new("settings_invalid", format!("设置格式无效：{error}")))?;
    settings.schema_version = schema_version;
    Ok(LoadedSettings {
        settings,
        schema_version,
    })
}

fn migrate_settings(settings: &mut AppSettings, source_version: u32) -> AppResult<()> {
    if source_version > SETTINGS_SCHEMA_VERSION {
        return Err(AppError::new(
            "settings_version_unsupported",
            format!(
                "设置来自更高版本（schema {source_version}），当前仅支持 schema {SETTINGS_SCHEMA_VERSION}"
            ),
        ));
    }

    let mut version = source_version;
    while version < SETTINGS_SCHEMA_VERSION {
        match version {
            0 => migrate_v0_to_v1(settings),
            1 => migrate_v1_to_v2(settings),
            _ => {
                return Err(AppError::new(
                    "settings_migration_missing",
                    format!("缺少从 schema {version} 开始的设置迁移"),
                ));
            }
        }
        version += 1;
        settings.schema_version = version;
    }
    Ok(())
}

fn migrate_v0_to_v1(_settings: &mut AppSettings) {
    // Legacy settings did not carry a schema version. Serde has already supplied
    // the defaults introduced by schema 1.
}

fn migrate_v1_to_v2(_settings: &mut AppSettings) {
    // Schema 2 only added fields with backward-compatible defaults.
}

fn sanitize_loaded_settings(settings: &mut AppSettings) {
    if !matches!(settings.language.as_str(), "zh" | "en") {
        settings.language = "zh".into();
    }
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        settings.theme = "system".into();
    }
    if !matches!(settings.editor_width.as_str(), "normal" | "wide" | "full") {
        settings.editor_width = "full".into();
    }
    if !matches!(
        settings.attachment_mode.as_str(),
        "same" | "subfolder" | "docSubfolder" | "vault" | "vaultSubfolder"
    ) {
        settings.attachment_mode = "subfolder".into();
    }
    if !valid_folder_name(&settings.attachment_folder) {
        settings.attachment_folder = "assets".into();
    }
    settings.image_max_width = settings.image_max_width.min(10_000);
    let mut seen_shortcuts = BTreeSet::new();
    settings.shortcuts.retain(|action, binding| {
        SHORTCUT_ACTIONS.contains(&action.as_str())
            && valid_shortcut_binding(binding)
            && seen_shortcuts.insert(binding.clone())
    });
    limit_collections(settings);
}

fn validate_settings(settings: &AppSettings) -> AppResult<()> {
    if !matches!(settings.language.as_str(), "zh" | "en")
        || !matches!(settings.theme.as_str(), "system" | "light" | "dark")
        || !matches!(settings.editor_width.as_str(), "normal" | "wide" | "full")
        || !matches!(
            settings.attachment_mode.as_str(),
            "same" | "subfolder" | "docSubfolder" | "vault" | "vaultSubfolder"
        )
    {
        return Err(AppError::new("settings_invalid", "设置选项无效"));
    }
    if !valid_folder_name(&settings.attachment_folder) {
        return Err(AppError::new("settings_invalid", "附件目录名称无效"));
    }
    if settings.image_max_width > 10_000 {
        return Err(AppError::new("settings_invalid", "图片宽度设置过大"));
    }
    let unique_shortcuts = settings.shortcuts.values().collect::<BTreeSet<_>>();
    if settings.shortcuts.len() > MAX_SHORTCUT_OVERRIDES
        || unique_shortcuts.len() != settings.shortcuts.len()
        || settings.shortcuts.iter().any(|(action, binding)| {
            !SHORTCUT_ACTIONS.contains(&action.as_str()) || !valid_shortcut_binding(binding)
        })
    {
        return Err(AppError::new("settings_invalid", "快捷键设置无效"));
    }
    if settings.custom_css_path.len() > MAX_PATH_LENGTH
        || settings
            .asset_search_paths
            .iter()
            .chain(settings.recent_files.iter())
            .chain(settings.recent_folders.iter())
            .chain(settings.favorites.iter())
            .chain(settings.session.open_files.iter())
            .chain(settings.session.folder.iter())
            .chain(settings.session.active_path.iter())
            .any(|path| path.len() > MAX_PATH_LENGTH)
    {
        return Err(AppError::new("settings_invalid", "设置中的路径过长"));
    }
    Ok(())
}

fn valid_folder_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 64
        && !matches!(trimmed, "." | "..")
        && !trimmed.contains(['/', '\\'])
}

fn valid_shortcut_binding(binding: &str) -> bool {
    if binding.is_empty() || binding.len() > 64 {
        return false;
    }
    let parts = binding.split('+').collect::<Vec<_>>();
    if parts.len() < 2 || parts.iter().any(|part| part.is_empty()) {
        return false;
    }
    let modifiers = &parts[..parts.len() - 1];
    modifiers
        .iter()
        .all(|part| matches!(*part, "Mod" | "Control" | "Alt" | "Shift"))
        && modifiers
            .iter()
            .any(|part| matches!(*part, "Mod" | "Control" | "Alt"))
}

fn limit_collections(settings: &mut AppSettings) {
    settings.recent_files.truncate(MAX_RECENT_ITEMS);
    settings.recent_folders.truncate(MAX_RECENT_ITEMS);
    settings.favorites.truncate(MAX_FAVORITES);
    settings.session.open_files.truncate(MAX_SESSION_FILES);
    settings.asset_search_paths.truncate(MAX_ASSET_SEARCH_PATHS);
}

fn write_settings(path: &Path, settings: &AppSettings) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("settings_path_failed", "设置路径没有父目录"))?;
    fs::create_dir_all(parent).map_err(|error| AppError::io("创建设置目录失败", error))?;
    let content = serde_json::to_vec_pretty(settings)
        .map_err(|error| AppError::new("settings_serialize_failed", error.to_string()))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| AppError::io("创建设置临时文件失败", error))?;
    temporary
        .write_all(&content)
        .map_err(|error| AppError::io("写入设置失败", error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| AppError::io("同步设置失败", error))?;
    temporary
        .persist(path)
        .map_err(|error| AppError::io("保存设置失败", error.error))?;
    Ok(())
}

fn apply_patch(settings: &mut AppSettings, patch: SettingsPatch) {
    macro_rules! replace_if_some {
        ($field:ident) => {
            if let Some(value) = patch.$field {
                settings.$field = value;
            }
        };
    }

    replace_if_some!(attachment_mode);
    replace_if_some!(attachment_folder);
    replace_if_some!(image_max_width);
    replace_if_some!(language);
    replace_if_some!(theme);
    replace_if_some!(editor_width);
    replace_if_some!(custom_css_path);
    replace_if_some!(heading_number);
    replace_if_some!(auto_save);
    replace_if_some!(check_updates_on_startup);
    replace_if_some!(shortcuts);
    replace_if_some!(recent_files);
    replace_if_some!(recent_folders);
    replace_if_some!(favorites);
    replace_if_some!(session);
    replace_if_some!(hide_attachment_folders);
    replace_if_some!(asset_search_paths);
}

fn authorize_settings_paths(app: &AppHandle, settings: &AppSettings) {
    let fs_scope = app.fs_scope();
    let asset_scope = app.asset_protocol_scope();

    for folder in settings
        .recent_folders
        .iter()
        .chain(settings.favorites.iter())
        .chain(settings.session.folder.iter())
        .chain(settings.asset_search_paths.iter())
    {
        if Path::new(folder).is_dir() {
            let _ = fs_scope.allow_directory(folder, true);
            let _ = asset_scope.allow_directory(folder, true);
        }
    }

    for file in settings
        .recent_files
        .iter()
        .chain(settings.session.open_files.iter())
        .chain((!settings.custom_css_path.is_empty()).then_some(&settings.custom_css_path))
    {
        if Path::new(file).is_file() {
            let _ = fs_scope.allow_file(file);
            let _ = asset_scope.allow_file(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_patch, migrate_settings, parse_settings, validate_settings, AppSettings,
        SettingsPatch, SETTINGS_SCHEMA_VERSION,
    };

    #[test]
    fn legacy_settings_receive_current_defaults() {
        let loaded =
            parse_settings(r#"{"language":"en"}"#).expect("legacy settings should remain readable");
        assert_eq!(loaded.schema_version, 0);
        let mut settings = loaded.settings;
        migrate_settings(&mut settings, loaded.schema_version).expect("legacy migration");
        assert_eq!(settings.schema_version, SETTINGS_SCHEMA_VERSION);
        assert_eq!(settings.language, "en");
        assert_eq!(settings.attachment_folder, "assets");
        assert!(settings.check_updates_on_startup);
    }

    #[test]
    fn rejects_settings_from_a_newer_schema_without_downgrading_them() {
        let future = SETTINGS_SCHEMA_VERSION + 1;
        let loaded = parse_settings(&format!(r#"{{"schemaVersion":{future},"language":"en"}}"#))
            .expect("future settings should parse before migration validation");
        let mut settings = loaded.settings;
        let error = migrate_settings(&mut settings, loaded.schema_version)
            .expect_err("future settings must not be rewritten by an older app");
        assert_eq!(error.code, "settings_version_unsupported");
        assert_eq!(settings.schema_version, future);
    }

    #[test]
    fn patch_only_changes_explicit_fields() {
        let mut settings = AppSettings::default();
        apply_patch(
            &mut settings,
            SettingsPatch {
                language: Some("en".into()),
                auto_save: Some(true),
                ..SettingsPatch::default()
            },
        );
        assert_eq!(settings.language, "en");
        assert!(settings.auto_save);
        assert_eq!(settings.theme, "system");
    }

    #[test]
    fn rejects_conflicting_or_malformed_shortcuts() {
        let mut settings = AppSettings::default();
        settings.shortcuts.insert("save".into(), "Mod+Alt+S".into());
        settings
            .shortcuts
            .insert("open-file".into(), "Mod+Alt+S".into());
        assert!(validate_settings(&settings).is_err());

        settings.shortcuts.clear();
        settings.shortcuts.insert("save".into(), "S".into());
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn accepts_the_select_all_shortcut_exposed_by_the_frontend() {
        let mut settings = AppSettings::default();
        settings
            .shortcuts
            .insert("select-all".into(), "Mod+A".into());
        assert!(validate_settings(&settings).is_ok());
    }
}
