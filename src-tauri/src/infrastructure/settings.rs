use super::{
    settings_model::SETTINGS_SCHEMA_VERSION,
    settings_validation::{
        limit_collections, migrate_settings, sanitize_loaded_settings, validate_settings,
    },
};
use crate::domain::error::{AppError, AppResult};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

pub use super::settings_model::{AppSettings, SettingsPatch};

#[derive(Default)]
struct SettingsState {
    cache: Option<AppSettings>,
    read_only: bool,
}

#[derive(Default)]
pub struct SettingsStore {
    state: Mutex<SettingsState>,
}

impl SettingsStore {
    pub fn get(&self, app: &AppHandle) -> AppResult<AppSettings> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::new("settings_lock_failed", "设置缓存不可用"))?;
        if let Some(settings) = guard.cache.as_ref() {
            return Ok(settings.clone());
        }

        let loaded = load_settings(app)?;
        guard.cache = Some(loaded.settings.clone());
        guard.read_only = loaded.read_only;
        let settings = loaded.settings;
        Ok(settings)
    }

    pub fn set_transactional<Apply, Rollback>(
        &self,
        app: &AppHandle,
        patch: SettingsPatch,
        apply: Apply,
        rollback: Rollback,
    ) -> AppResult<AppSettings>
    where
        Apply: FnOnce(&AppSettings) -> AppResult<()>,
        Rollback: FnOnce(&AppSettings),
    {
        // Keep the cache lock for the full read-modify-write transaction. Tauri
        // commands can run concurrently; releasing it between get and write
        // allowed unrelated patches (for example recents and session state) to
        // overwrite each other.
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::new("settings_lock_failed", "设置缓存不可用"))?;
        let current = match guard.cache.as_ref() {
            Some(settings) => settings.clone(),
            None => {
                let loaded = load_settings(app)?;
                guard.read_only = loaded.read_only;
                loaded.settings
            }
        };
        if guard.read_only {
            return Err(AppError::new(
                "settings_read_only",
                "设置来自更高版本，当前版本以只读兼容模式运行",
            ));
        }
        let mut settings = current.clone();
        apply_patch(&mut settings, patch);
        validate_settings(&settings)?;
        limit_collections(&mut settings);
        settings.schema_version = SETTINGS_SCHEMA_VERSION;
        apply(&settings)?;
        if let Err(error) = write_settings(&settings_file(app)?, &settings) {
            rollback(&current);
            return Err(error);
        }
        guard.cache = Some(settings.clone());
        Ok(settings)
    }
}

struct SettingsLoad {
    settings: AppSettings,
    read_only: bool,
}

fn load_settings(app: &AppHandle) -> AppResult<SettingsLoad> {
    let settings_path = settings_file(app)?;
    let legacy = legacy_settings_file();
    load_settings_paths(&settings_path, legacy.as_deref())
}

fn load_settings_paths(
    settings_path: &Path,
    legacy_path: Option<&Path>,
) -> AppResult<SettingsLoad> {
    if settings_path.is_file() {
        match read_settings(settings_path) {
            Ok(loaded) if loaded.schema_version > SETTINGS_SCHEMA_VERSION => {
                let mut settings = loaded.settings;
                sanitize_loaded_settings(&mut settings);
                return Ok(SettingsLoad {
                    settings,
                    read_only: true,
                });
            }
            Ok(loaded) => {
                let source_version = loaded.schema_version;
                let mut settings = loaded.settings;
                migrate_settings(&mut settings, source_version)?;
                sanitize_loaded_settings(&mut settings);
                if source_version < SETTINGS_SCHEMA_VERSION {
                    write_settings(settings_path, &settings)?;
                }
                return Ok(SettingsLoad {
                    settings,
                    read_only: false,
                });
            }
            Err(error) => {
                quarantine_invalid_settings(settings_path);
                eprintln!("settings recovery: {}", error.code);
                let settings = AppSettings::default();
                write_settings(settings_path, &settings)?;
                return Ok(SettingsLoad {
                    settings,
                    read_only: false,
                });
            }
        }
    }

    if let Some(legacy) = legacy_path.filter(|path| path.is_file()) {
        if let Ok(loaded) = read_settings(legacy) {
            if loaded.schema_version <= SETTINGS_SCHEMA_VERSION {
                let source_version = loaded.schema_version;
                let mut settings = loaded.settings;
                migrate_settings(&mut settings, source_version)?;
                sanitize_loaded_settings(&mut settings);
                write_settings(settings_path, &settings)?;
                return Ok(SettingsLoad {
                    settings,
                    read_only: false,
                });
            }
        }
    }

    let settings = AppSettings::default();
    write_settings(settings_path, &settings)?;
    Ok(SettingsLoad {
        settings,
        read_only: false,
    })
}

fn quarantine_invalid_settings(path: &Path) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let backup = path.with_file_name(format!("settings.invalid-{stamp}.json"));
    let _ = fs::rename(path, backup);
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
    let metadata = fs::metadata(path).map_err(|error| AppError::io("读取设置失败", error))?;
    if metadata.len() > MAX_SETTINGS_BYTES {
        return Err(AppError::new(
            "settings_too_large",
            "设置文件超过 1 MB，已停止读取",
        ));
    }
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
    replace_if_some!(background_image_path);
    replace_if_some!(background_opacity);
    replace_if_some!(code_block_opacity);
    replace_if_some!(theme_shade);
    replace_if_some!(heading_number);
    replace_if_some!(auto_save);
    replace_if_some!(check_updates_on_startup);
    replace_if_some!(shortcuts);
    replace_if_some!(recent_files);
    replace_if_some!(recent_folders);
    replace_if_some!(favorites);
    replace_if_some!(favorite_files);
    replace_if_some!(favorites_collapsed);
    replace_if_some!(pinned_tags);
    replace_if_some!(tag_collapsed_keys);
    replace_if_some!(tag_default_expand_depth);
    replace_if_some!(tag_groups_first);
    replace_if_some!(tag_result_sort);
    replace_if_some!(tag_click_opens_overview);
    replace_if_some!(favorite_labels);
    replace_if_some!(session);
    replace_if_some!(file_tree_sort);
    replace_if_some!(pinned_folders);
    replace_if_some!(hide_attachment_folders);
    replace_if_some!(asset_search_paths);
    replace_if_some!(show_all_files);
    replace_if_some!(visible_text_extensions);
    replace_if_some!(hidden_workspace_paths);
    replace_if_some!(hidden_name_patterns);
    replace_if_some!(allow_remote_images);
    replace_if_some!(show_toolbar);
    replace_if_some!(show_selection_toolbar);
    replace_if_some!(table_auto_width);
    replace_if_some!(table_auto_resize);
    replace_if_some!(show_status_bar);
    replace_if_some!(show_status_path);
    replace_if_some!(show_reading_mode_control);
    replace_if_some!(show_source_mode_control);
    replace_if_some!(show_reveal_button);
    replace_if_some!(show_open_folder_button);
    replace_if_some!(show_settings_button);
    replace_if_some!(image_copy_mode);
    replace_if_some!(mermaid_copy_mode);
    replace_if_some!(pandoc_path);
    replace_if_some!(pandoc_reference_doc);
    replace_if_some!(pandoc_export_args);
    replace_if_some!(pandoc_import_args);
    replace_if_some!(pandoc_media_folder);
    replace_if_some!(pandoc_toc);
    replace_if_some!(pandoc_number_sections);
    replace_if_some!(pandoc_normalize_fonts);
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
