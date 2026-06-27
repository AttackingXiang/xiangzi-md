use crate::domain::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;
use tempfile::NamedTempFile;

const SETTINGS_SCHEMA_VERSION: u32 = 1;

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
    pub recent_files: Option<Vec<String>>,
    pub recent_folders: Option<Vec<String>>,
    pub favorites: Option<Vec<String>>,
    pub session: Option<SessionSettings>,
    pub hide_attachment_folders: Option<bool>,
    pub asset_search_paths: Option<Vec<String>>,
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

        let settings_path = settings_file(app)?;
        let (settings, imported) = if settings_path.is_file() {
            (read_settings(&settings_path)?, false)
        } else if let Some(legacy) = legacy_settings_file().filter(|path| path.is_file()) {
            (read_settings(&legacy)?, true)
        } else {
            (AppSettings::default(), true)
        };

        if imported {
            write_settings(&settings_path, &settings)?;
        }
        authorize_settings_paths(app, &settings);
        *guard = Some(settings.clone());
        Ok(settings)
    }

    pub fn set(&self, app: &AppHandle, patch: SettingsPatch) -> AppResult<AppSettings> {
        let mut settings = self.get(app)?;
        apply_patch(&mut settings, patch);
        settings.schema_version = SETTINGS_SCHEMA_VERSION;
        write_settings(&settings_file(app)?, &settings)?;
        authorize_settings_paths(app, &settings);

        let mut guard = self
            .cache
            .lock()
            .map_err(|_| AppError::new("settings_lock_failed", "设置缓存不可用"))?;
        *guard = Some(settings.clone());
        Ok(settings)
    }
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

fn read_settings(path: &Path) -> AppResult<AppSettings> {
    let raw = fs::read_to_string(path).map_err(|error| AppError::io("读取设置失败", error))?;
    serde_json::from_str(&raw)
        .map_err(|error| AppError::new("settings_invalid", format!("设置格式无效：{error}")))
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
    use super::{apply_patch, AppSettings, SettingsPatch, SETTINGS_SCHEMA_VERSION};

    #[test]
    fn legacy_settings_receive_current_defaults() {
        let settings: AppSettings = serde_json::from_str(r#"{"language":"en"}"#)
            .expect("legacy settings should remain readable");
        assert_eq!(settings.schema_version, SETTINGS_SCHEMA_VERSION);
        assert_eq!(settings.language, "en");
        assert_eq!(settings.attachment_folder, "assets");
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
}
