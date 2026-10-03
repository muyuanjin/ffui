use super::*;
use serde_json::json;
use std::fs;
use tempfile::tempdir;

#[test]
fn missing_settings_file_loads_explicit_defaults_without_creating_files() {
    let directory = tempdir().expect("directory");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    assert_eq!(
        load_settings().expect("defaults").queue_persistence_mode,
        QueuePersistenceMode::None
    );
    assert_eq!(fs::read_dir(directory.path()).expect("entries").count(), 0);
}

#[cfg(unix)]
#[test]
fn unreadable_settings_path_is_not_treated_as_missing_preferences() {
    let directory = tempdir().expect("directory");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = crate::ffui_core::data_root::settings_path().expect("path");
    std::os::unix::fs::symlink(&path, &path).expect("symlink cycle");
    assert!(
        format!("{:#}", load_settings().expect_err("read failure"))
            .contains("failed to read settings file")
    );
    assert!(path.is_symlink());
}

#[test]
fn corrupt_primary_is_preserved_without_using_or_overwriting_existing_backup() {
    let directory = tempdir().expect("directory");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = crate::ffui_core::data_root::settings_path().expect("path");
    let backup = directory.path().join("ffui.settings.last-good.json");
    let previous = json!({"version": 1, "settings": {"locale": "zh-CN"}}).to_string();
    fs::write(&backup, &previous).expect("existing backup");
    fs::write(&path, b"{interrupted").expect("corrupt primary");
    assert!(load_settings().is_err());
    assert!(save_settings(&AppSettings::default()).is_err());
    assert_eq!(fs::read(&path).expect("primary"), b"{interrupted");
    assert_eq!(fs::read_to_string(backup).expect("backup"), previous);
    assert_eq!(fs::read_dir(directory.path()).expect("entries").count(), 2);
}

#[test]
fn unsupported_mode_preserves_other_preferences_and_blocks_only_related_changes() {
    let directory = tempdir().expect("directory");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = crate::ffui_core::data_root::settings_path().expect("path");
    let raw = json!({"version": 2, "settings": {"queuePersistenceMode": "crashRecoveryLite", "queuePresetSelection": {"mode": "future-mode"}}});
    fs::write(&path, raw.to_string()).expect("settings");
    let mut store = SettingsStore::open().expect("partial settings");
    let snapshot = store.snapshot();
    assert_eq!(
        snapshot.settings.queue_persistence_mode,
        QueuePersistenceMode::CrashRecoveryLite
    );
    assert_eq!(
        snapshot.unavailable_settings[0].path,
        "/queuePresetSelection"
    );
    let mut changed = snapshot.settings.clone();
    changed.locale = Some("zh-CN".into());
    store.update(&changed).expect("unrelated edit");
    changed.queue_preset_selection = Some(super::super::types::QueuePresetSelection::Unified);
    assert!(store.update(&changed).is_err());
    let saved: Value = serde_json::from_slice(&fs::read(&path).expect("bytes")).expect("JSON");
    assert_eq!(
        saved["settings"]["queuePresetSelection"],
        raw["settings"]["queuePresetSelection"]
    );
}

#[test]
fn newer_file_version_is_readable_but_not_writable() {
    let directory = tempdir().expect("directory");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = crate::ffui_core::data_root::settings_path().expect("path");
    let raw = json!({"version": 999, "settings": {"locale": "zh-CN", "onboardingCompleted": true}})
        .to_string();
    fs::write(&path, &raw).expect("settings");
    let loaded = load_settings().expect("readable view");
    assert_eq!(loaded.locale.as_deref(), Some("zh-CN"));
    assert!(loaded.onboarding_completed);
    assert!(save_settings(&loaded).is_err());
    assert_eq!(fs::read_to_string(path).expect("unchanged file"), raw);
}
