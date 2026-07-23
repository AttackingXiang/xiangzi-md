use super::settings_model::{
    AppSettings, RecentDoc, MAX_ASSET_SEARCH_PATHS, MAX_FAVORITES, MAX_FAVORITE_LABEL_CHARS,
    MAX_HIDDEN_WORKSPACE_PATHS, MAX_PANDOC_ARGS_LENGTH, MAX_PATH_LENGTH, MAX_PINNED_FOLDERS,
    MAX_RECENT_DOCS, MAX_RECENT_ITEMS, MAX_SESSION_FILES, MAX_SHORTCUT_OVERRIDES,
    MAX_TAG_COLLAPSED_KEYS, SETTINGS_SCHEMA_VERSION, SHORTCUT_ACTIONS,
};

const FILE_TREE_SORT_MODES: &[&str] = &["default", "nameDesc", "modified", "opened", "smart"];
use crate::domain::{
    error::{AppError, AppResult},
    safe_name::is_valid_portable_name,
};
use std::{collections::BTreeSet, path::Path};

pub(super) fn migrate_settings(settings: &mut AppSettings, source_version: u32) -> AppResult<()> {
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
            2 => migrate_v2_to_v3(settings),
            3 => migrate_v3_to_v4(settings),
            4 => migrate_v4_to_v5(settings),
            5 => migrate_v5_to_v6(settings),
            6 => migrate_v6_to_v7(settings),
            7 => migrate_v7_to_v8(settings),
            8 => migrate_v8_to_v9(settings),
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

fn migrate_v0_to_v1(_settings: &mut AppSettings) {}
fn migrate_v1_to_v2(_settings: &mut AppSettings) {}
fn migrate_v2_to_v3(_settings: &mut AppSettings) {}
fn migrate_v3_to_v4(_settings: &mut AppSettings) {}
fn migrate_v4_to_v5(_settings: &mut AppSettings) {}
fn migrate_v5_to_v6(_settings: &mut AppSettings) {}
fn migrate_v6_to_v7(_settings: &mut AppSettings) {}
fn migrate_v7_to_v8(_settings: &mut AppSettings) {}

/// v8→v9：把纯 MRU 的 recent_files 灌进 frecency 语料 recent_docs，让老用户升级后立即
/// 有打分原料。open_count 一律 1，last_opened_nanos 按 MRU 次序递减造一个单调时间戳
/// （队首最新），last_edited_nanos 置 0。已有 recent_docs 时不覆盖。
fn migrate_v8_to_v9(settings: &mut AppSettings) {
    if !settings.recent_docs.is_empty() {
        return;
    }
    let count = settings.recent_files.len() as i64;
    settings.recent_docs = settings
        .recent_files
        .iter()
        .enumerate()
        .map(|(index, path)| RecentDoc {
            path: path.clone(),
            open_count: 1,
            last_opened_nanos: count - index as i64,
            last_edited_nanos: 0,
        })
        .collect();
}

pub(super) fn sanitize_loaded_settings(settings: &mut AppSettings) {
    if !matches!(settings.language.as_str(), "zh" | "en") {
        settings.language = "zh".into();
    }
    if !matches!(
        settings.theme.as_str(),
        "system" | "light" | "dark" | "warm" | "mint" | "blue" | "summer" | "sakura"
    ) {
        settings.theme = "system".into();
    }
    if !matches!(settings.editor_width.as_str(), "normal" | "wide" | "full") {
        settings.editor_width = "full".into();
    }
    if !matches!(settings.clipboard_format.as_str(), "rich" | "plain") {
        settings.clipboard_format = "rich".into();
    }
    if !matches!(
        settings.table_auto_width.as_str(),
        "distribute" | "fit" | "equal"
    ) {
        settings.table_auto_width = "distribute".into();
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
    if !valid_folder_name(&settings.pandoc_media_folder) {
        settings.pandoc_media_folder = "assets".into();
    }
    if settings.pandoc_export_args.len() > MAX_PANDOC_ARGS_LENGTH {
        settings.pandoc_export_args.clear();
    }
    if settings.pandoc_import_args.len() > MAX_PANDOC_ARGS_LENGTH {
        settings.pandoc_import_args.clear();
    }
    settings.image_max_width = settings.image_max_width.min(10_000);
    let mut seen_shortcuts = BTreeSet::new();
    settings.shortcuts.retain(|action, binding| {
        SHORTCUT_ACTIONS.contains(&action.as_str())
            && valid_shortcut_binding(binding)
            && seen_shortcuts.insert(binding.clone())
    });
    for label in settings.favorite_labels.values_mut() {
        *label = label.trim().to_owned();
    }
    settings
        .favorite_labels
        .retain(|_, label| valid_favorite_label(label));
    settings.hidden_workspace_paths.retain(|path| {
        !path.trim().is_empty() && path.len() <= MAX_PATH_LENGTH && Path::new(path).is_absolute()
    });
    if !FILE_TREE_SORT_MODES.contains(&settings.file_tree_sort.as_str()) {
        settings.file_tree_sort = "default".into();
    }
    settings
        .recent_docs
        .retain(|doc| !doc.path.trim().is_empty() && doc.path.len() <= MAX_PATH_LENGTH);
    settings.pinned_folders.retain(|path| {
        !path.trim().is_empty() && path.len() <= MAX_PATH_LENGTH && Path::new(path).is_absolute()
    });
    if !settings.background_image_path.is_empty() && !valid_background_image_path(settings) {
        settings.background_image_path.clear();
    }
    settings.background_opacity = settings.background_opacity.min(100);
    settings.code_block_opacity = settings.code_block_opacity.min(100);
    settings.theme_shade = settings.theme_shade.clamp(-50, 50);
    limit_collections(settings);
}

fn valid_background_image_path(settings: &AppSettings) -> bool {
    settings.background_image_path.len() <= MAX_PATH_LENGTH
        && Path::new(&settings.background_image_path).is_absolute()
}

pub(super) fn validate_settings(settings: &AppSettings) -> AppResult<()> {
    if !matches!(settings.language.as_str(), "zh" | "en")
        || !matches!(
            settings.theme.as_str(),
            "system" | "light" | "dark" | "warm" | "mint" | "blue" | "summer" | "sakura"
        )
        || !matches!(settings.editor_width.as_str(), "normal" | "wide" | "full")
        || !matches!(settings.clipboard_format.as_str(), "rich" | "plain")
        || !matches!(
            settings.table_auto_width.as_str(),
            "distribute" | "fit" | "equal"
        )
        || !matches!(
            settings.attachment_mode.as_str(),
            "same" | "subfolder" | "docSubfolder" | "vault" | "vaultSubfolder"
        )
    {
        return Err(AppError::new("settings_invalid", "设置选项无效"));
    }
    if !settings.background_image_path.is_empty() && !valid_background_image_path(settings) {
        return Err(AppError::new("settings_invalid", "背景图片路径无效"));
    }
    if settings.background_opacity > 100 {
        return Err(AppError::new("settings_invalid", "背景图片强度超出范围"));
    }
    if settings.code_block_opacity > 100 {
        return Err(AppError::new("settings_invalid", "代码块不透明度超出范围"));
    }
    if !(-50..=50).contains(&settings.theme_shade) {
        return Err(AppError::new("settings_invalid", "主题深浅超出范围"));
    }
    if !valid_folder_name(&settings.attachment_folder) {
        return Err(AppError::new("settings_invalid", "附件目录名称无效"));
    }
    if !valid_folder_name(&settings.pandoc_media_folder) {
        return Err(AppError::new("settings_invalid", "Word 媒体目录名称无效"));
    }
    if settings.pandoc_export_args.len() > MAX_PANDOC_ARGS_LENGTH
        || settings.pandoc_import_args.len() > MAX_PANDOC_ARGS_LENGTH
    {
        return Err(AppError::new("settings_invalid", "Pandoc 附加参数过长"));
    }
    if settings.image_max_width > 10_000 {
        return Err(AppError::new("settings_invalid", "图片宽度设置过大"));
    }
    if !FILE_TREE_SORT_MODES.contains(&settings.file_tree_sort.as_str()) {
        return Err(AppError::new("settings_invalid", "文件树排序方式无效"));
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
        || settings.pandoc_path.len() > MAX_PATH_LENGTH
        || settings.pandoc_reference_doc.len() > MAX_PATH_LENGTH
        || settings
            .asset_search_paths
            .iter()
            .chain(settings.hidden_workspace_paths.iter())
            .chain(settings.recent_files.iter())
            .chain(settings.recent_folders.iter())
            .chain(settings.pinned_folders.iter())
            .chain(settings.favorites.iter())
            .chain(settings.favorite_labels.keys())
            .chain(settings.session.open_files.iter())
            .chain(settings.session.folder.iter())
            .chain(settings.session.active_path.iter())
            .any(|path| path.len() > MAX_PATH_LENGTH)
    {
        return Err(AppError::new("settings_invalid", "设置中的路径过长"));
    }
    if settings
        .favorite_labels
        .values()
        .any(|label| !valid_favorite_label(label))
    {
        return Err(AppError::new("settings_invalid", "收藏目录名称无效"));
    }
    if settings
        .hidden_workspace_paths
        .iter()
        .any(|path| path.trim().is_empty() || !Path::new(path).is_absolute())
    {
        return Err(AppError::new("settings_invalid", "隐藏目录必须是绝对路径"));
    }
    if settings
        .pinned_folders
        .iter()
        .any(|path| path.trim().is_empty() || !Path::new(path).is_absolute())
    {
        return Err(AppError::new("settings_invalid", "置顶目录必须是绝对路径"));
    }
    Ok(())
}

fn valid_folder_name(value: &str) -> bool {
    is_valid_portable_name(value, 64)
}

fn valid_shortcut_binding(binding: &str) -> bool {
    if binding.is_empty() || binding.len() > 64 {
        return false;
    }
    let parts = binding.split('+').collect::<Vec<_>>();
    if parts.iter().any(|part| part.is_empty()) {
        return false;
    }
    let modifiers = &parts[..parts.len() - 1];
    let unique_modifiers = modifiers.iter().collect::<BTreeSet<_>>();
    let key = parts[parts.len() - 1];
    modifiers
        .iter()
        .all(|part| matches!(*part, "Mod" | "Control" | "Alt" | "Shift"))
        && (key.starts_with('F')
            || modifiers
                .iter()
                .any(|part| matches!(*part, "Mod" | "Control" | "Alt")))
        && unique_modifiers.len() == modifiers.len()
        && valid_shortcut_key(key)
}

fn valid_shortcut_key(key: &str) -> bool {
    if key.len() == 1 {
        return key
            .chars()
            .next()
            .is_some_and(|value| value.is_ascii_uppercase() || value.is_ascii_digit())
            || matches!(
                key,
                "," | "." | "/" | ";" | "=" | "'" | "`" | "[" | "]" | "\\" | "-"
            );
    }
    matches!(
        key,
        "Space"
            | "Enter"
            | "Escape"
            | "Tab"
            | "Backspace"
            | "Delete"
            | "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "F1"
            | "F2"
            | "F3"
            | "F4"
            | "F5"
            | "F6"
            | "F7"
            | "F8"
            | "F9"
            | "F10"
            | "F11"
            | "F12"
    )
}

fn valid_favorite_label(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.chars().count() <= MAX_FAVORITE_LABEL_CHARS
        && !trimmed.chars().any(char::is_control)
}

pub(super) fn limit_collections(settings: &mut AppSettings) {
    settings.recent_files.truncate(MAX_RECENT_ITEMS);
    settings.recent_folders.truncate(MAX_RECENT_ITEMS);
    // 语料库超限时按最近打开时间保留最新的一批。
    if settings.recent_docs.len() > MAX_RECENT_DOCS {
        settings
            .recent_docs
            .sort_by_key(|d| std::cmp::Reverse(d.last_opened_nanos));
        settings.recent_docs.truncate(MAX_RECENT_DOCS);
    }
    settings.pinned_folders.truncate(MAX_PINNED_FOLDERS);
    settings.favorites.truncate(MAX_FAVORITES);
    let favorites = settings.favorites.iter().cloned().collect::<BTreeSet<_>>();
    settings
        .favorite_files
        .retain(|path| favorites.contains(path));
    settings
        .favorite_labels
        .retain(|path, _| favorites.contains(path));
    settings.session.open_files.truncate(MAX_SESSION_FILES);
    settings.tag_collapsed_keys.truncate(MAX_TAG_COLLAPSED_KEYS);
    settings.tag_default_expand_depth = settings.tag_default_expand_depth.clamp(-1, 32);
    if settings.tag_result_sort != "name" {
        settings.tag_result_sort = "updated".into();
    }
    if !matches!(
        settings.tag_tree_sort.as_str(),
        "name" | "nameDesc" | "smart"
    ) {
        settings.tag_tree_sort = "count".into();
    }
    settings.asset_search_paths.truncate(MAX_ASSET_SEARCH_PATHS);
    settings
        .hidden_workspace_paths
        .truncate(MAX_HIDDEN_WORKSPACE_PATHS);
}
