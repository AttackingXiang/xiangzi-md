use super::{
    apply_patch, load_settings_paths, migrate_settings, parse_settings, validate_settings,
    AppSettings, SettingsPatch, SETTINGS_SCHEMA_VERSION,
};
use std::fs;
use tempfile::tempdir;

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
    assert!(!settings.favorites_collapsed);
    assert!(settings.favorite_labels.is_empty());
    assert_eq!(settings.pandoc_media_folder, "assets");
    assert!(settings.pandoc_normalize_fonts);
    assert!(settings.pandoc_reference_doc.is_empty());
    assert_eq!(settings.background_opacity, 30);
    assert_eq!(settings.code_block_opacity, 30);
    assert!(settings.show_status_bar);
    assert!(settings.show_status_path);
    assert!(settings.show_reading_mode_control);
    assert!(settings.show_source_mode_control);
    assert!(settings.show_reveal_button);
}

#[test]
fn migrates_recent_files_into_frecency_corpus() {
    // schema 8：只有 recent_files 的 MRU；升级到 9 应灌进 recent_docs。
    let loaded = parse_settings(
        r#"{"schemaVersion":8,"recentFiles":["/a.md","/b.md","/c.md"]}"#,
    )
    .expect("v8 settings parse");
    let mut settings = loaded.settings;
    migrate_settings(&mut settings, loaded.schema_version).expect("v8→v9 migration");
    assert_eq!(settings.schema_version, SETTINGS_SCHEMA_VERSION);

    let paths: Vec<&str> = settings.recent_docs.iter().map(|d| d.path.as_str()).collect();
    assert_eq!(paths, ["/a.md", "/b.md", "/c.md"]);
    // 每项 open_count=1、未编辑；队首 last_opened 最大（最新）。
    assert!(settings.recent_docs.iter().all(|d| d.open_count == 1 && d.last_edited_nanos == 0));
    assert!(
        settings.recent_docs[0].last_opened_nanos > settings.recent_docs[2].last_opened_nanos
    );
    // recent_files 镜像保持不变，供旧消费者。
    assert_eq!(settings.recent_files, vec!["/a.md", "/b.md", "/c.md"]);
}

#[test]
fn keeps_existing_recent_docs_over_recent_files_on_migration() {
    // 已有 recent_docs 时不该被 recent_files 覆盖。
    let loaded = parse_settings(
        r#"{"schemaVersion":8,"recentFiles":["/old.md"],"recentDocs":[{"path":"/kept.md","openCount":9,"lastOpenedNanos":42,"lastEditedNanos":7}]}"#,
    )
    .expect("v8 settings parse");
    let mut settings = loaded.settings;
    migrate_settings(&mut settings, loaded.schema_version).expect("v8→v9 migration");
    assert_eq!(settings.recent_docs.len(), 1);
    assert_eq!(settings.recent_docs[0].path, "/kept.md");
    assert_eq!(settings.recent_docs[0].open_count, 9);
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
fn quarantines_corrupt_settings_and_recovers_with_defaults() {
    let directory = tempdir().expect("temp settings directory");
    let path = directory.path().join("settings.json");
    fs::write(&path, b"{not-json").expect("seed corrupt settings");

    let loaded = load_settings_paths(&path, None).expect("recover settings");

    assert!(!loaded.read_only);
    assert_eq!(loaded.settings.schema_version, SETTINGS_SCHEMA_VERSION);
    assert!(path.is_file());
    assert!(fs::read_dir(directory.path())
        .expect("list settings directory")
        .filter_map(Result::ok)
        .any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with("settings.invalid-")));
}

#[test]
fn future_settings_remain_byte_for_byte_unchanged_in_read_only_mode() {
    let directory = tempdir().expect("temp settings directory");
    let path = directory.path().join("settings.json");
    let raw = format!(
        "{{\"schemaVersion\":{},\"language\":\"en\",\"futureField\":true}}",
        SETTINGS_SCHEMA_VERSION + 1
    );
    fs::write(&path, raw.as_bytes()).expect("seed future settings");

    let loaded = load_settings_paths(&path, None).expect("load future settings");

    assert!(loaded.read_only);
    assert_eq!(loaded.settings.language, "en");
    assert_eq!(
        fs::read_to_string(path).expect("read unchanged settings"),
        raw
    );
}

#[test]
fn patch_only_changes_explicit_fields() {
    let mut settings = AppSettings::default();
    apply_patch(
        &mut settings,
        SettingsPatch {
            language: Some("en".into()),
            auto_save: Some(true),
            show_status_bar: Some(false),
            ..SettingsPatch::default()
        },
    );
    assert_eq!(settings.language, "en");
    assert!(settings.auto_save);
    assert!(!settings.show_status_bar);
    assert!(settings.show_status_path);
    assert_eq!(settings.theme, "system");
}

#[test]
fn accepts_every_built_in_theme_preset_and_rejects_unknown_ones() {
    let mut settings = AppSettings::default();
    for theme in ["system", "light", "dark", "warm", "mint", "blue", "summer", "sakura"] {
        settings.theme = theme.into();
        assert!(
            validate_settings(&settings).is_ok(),
            "{theme} should validate"
        );
    }

    settings.theme = "sepia".into();
    assert!(validate_settings(&settings).is_err());
}

#[test]
fn validates_background_image_path_and_shade_bounds() {
    let mut settings = AppSettings::default();
    assert!(validate_settings(&settings).is_ok());

    settings.background_image_path = "relative/path.png".into();
    assert!(validate_settings(&settings).is_err());

    // 用 std::env::temp_dir() 而不是硬编码的 "/Users/..." 字符串：Unix 风格的
    // 前导 "/" 在 Windows 上不构成 Path::is_absolute()，硬编码路径在 Windows
    // CI 上会让这条本该通过的断言失败。
    let absolute_path = std::env::temp_dir().join("bg.png");
    settings.background_image_path = absolute_path.to_string_lossy().into_owned();
    assert!(validate_settings(&settings).is_ok());

    settings.background_opacity = 101;
    assert!(validate_settings(&settings).is_err());
    settings.background_opacity = 100;
    assert!(validate_settings(&settings).is_ok());

    settings.code_block_opacity = 101;
    assert!(validate_settings(&settings).is_err());
    settings.code_block_opacity = 0;
    assert!(validate_settings(&settings).is_ok());

    settings.theme_shade = 51;
    assert!(validate_settings(&settings).is_err());
    settings.theme_shade = -51;
    assert!(validate_settings(&settings).is_err());
    settings.theme_shade = -50;
    assert!(validate_settings(&settings).is_ok());
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

#[test]
fn accepts_heading_level_shortcuts_exposed_by_the_frontend() {
    let mut settings = AppSettings::default();
    settings
        .shortcuts
        .insert("promote-heading".into(), "Mod+Alt+ArrowUp".into());
    settings
        .shortcuts
        .insert("demote-heading".into(), "Mod+Alt+ArrowDown".into());
    assert!(validate_settings(&settings).is_ok());
}

#[test]
fn validates_favorite_display_labels_without_touching_folder_names() {
    let mut settings = AppSettings::default();
    settings.favorites.push("/notes/work".into());
    settings
        .favorite_labels
        .insert("/notes/work".into(), "工作资料".into());
    assert!(validate_settings(&settings).is_ok());

    settings
        .favorite_labels
        .insert("/notes/work".into(), "\n".into());
    assert!(validate_settings(&settings).is_err());
}
