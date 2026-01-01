use std::fs;

use serde_json::json;
use tempfile::tempdir;

use super::*;

#[test]
fn load_settings_backs_up_corrupt_json_and_returns_defaults() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    let corrupt = b"{ this is not json";
    fs::write(&path, corrupt).expect("write corrupt settings");

    let _ = load_settings().expect_err("load_settings should error on corrupt json");

    let mut backups: Vec<_> = fs::read_dir(data_dir.path())
        .expect("read settings dir")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("ffui.settings.json.corrupt-"))
        })
        .collect();
    backups.sort();
    assert!(
        !backups.is_empty(),
        "load_settings should create a recovery backup for corrupt settings"
    );

    let backup_content = fs::read(&backups[0]).expect("read backup file");
    assert_eq!(backup_content, corrupt);

    if path.exists() {
        let current = fs::read(&path).expect("read current settings path");
        assert_eq!(
            current, corrupt,
            "load_settings must not overwrite corrupt settings content"
        );
    }
}

#[test]
fn load_settings_recovers_from_last_good_when_main_settings_is_corrupt() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");
    let last_good_path = data_dir.path().join("ffui.settings.last-good.json");

    let last_good = serde_json::to_string_pretty(&json!({
        "version": 1,
        "settings": {
            "locale": "zh-CN",
            "onboardingCompleted": true
        }
    }))
    .expect("serialize last-good settings");
    fs::write(&last_good_path, &last_good).expect("write last-good settings");

    let corrupt = b"{ this is not json";
    fs::write(&path, corrupt).expect("write corrupt settings");

    let loaded = load_settings().expect("load_settings should recover from last-good");
    assert_eq!(loaded.locale.as_deref(), Some("zh-CN"));
    assert!(loaded.onboarding_completed);

    let mut backups: Vec<_> = fs::read_dir(data_dir.path())
        .expect("read settings dir")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("ffui.settings.json.corrupt-"))
        })
        .collect();
    backups.sort();
    assert!(
        !backups.is_empty(),
        "load_settings should create a corrupt backup before recovering"
    );

    let healed: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("read healed settings"))
            .expect("parse healed settings");
    assert_eq!(
        healed.get("version").and_then(serde_json::Value::as_u64),
        Some(1)
    );
    assert!(
        healed.get("settings").is_some(),
        "healed settings should use the versioned envelope"
    );
}

#[test]
fn load_settings_decodes_newer_version_envelope_best_effort() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    let raw = serde_json::to_string_pretty(&json!({
        "version": 999,
        "settings": {
            "locale": "zh-CN",
            "onboardingCompleted": true
        }
    }))
    .expect("serialize newer version settings");
    fs::write(&path, &raw).expect("write settings file");

    let loaded = load_settings().expect("load_settings should decode best-effort");
    assert_eq!(loaded.locale.as_deref(), Some("zh-CN"));
    assert!(loaded.onboarding_completed);

    let after = fs::read_to_string(&path).expect("read settings file after load");
    assert_eq!(
        after, raw,
        "load_settings should not rewrite settings.json for a newer version envelope"
    );
}
