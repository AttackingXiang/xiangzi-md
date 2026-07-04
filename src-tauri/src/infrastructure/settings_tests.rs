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
            ..SettingsPatch::default()
        },
    );
    assert_eq!(settings.language, "en");
    assert!(settings.auto_save);
    assert_eq!(settings.theme, "system");
}

#[test]
fn accepts_every_built_in_theme_preset_and_rejects_unknown_ones() {
    let mut settings = AppSettings::default();
    for theme in ["system", "light", "dark", "warm", "mint", "blue", "summer"] {
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
