use std::fs;

use tempfile::tempdir;

use super::*;

#[test]
fn pick_meta_mode_prefers_latest_timestamp() {
    let meta_a = meta::DataRootMeta {
        schema_version: 1,
        desired_mode: Some(DataRootMode::System),
        last_selected_at_ms: Some(10),
        fallback_notice_dismissed: Some(false),
    };
    let meta_b = meta::DataRootMeta {
        schema_version: 1,
        desired_mode: Some(DataRootMode::Portable),
        last_selected_at_ms: Some(20),
        fallback_notice_dismissed: Some(false),
    };
    assert_eq!(
        meta::pick_meta_mode(Some(&meta_a), Some(&meta_b)),
        Some(DataRootMode::Portable)
    );
}

#[test]
fn migrate_legacy_settings_picks_latest_candidate() {
    let exe_dir = tempdir().expect("temp exe dir");
    let data_dir = tempdir().expect("temp data dir");

    let first = exe_dir.path().join("old.settings.json");
    fs::write(&first, b"first").expect("write legacy settings");
    std::thread::sleep(std::time::Duration::from_millis(5));
    let second = exe_dir.path().join("new.settings.json");
    fs::write(&second, b"second").expect("write legacy settings");

    let state = DataRootState {
        desired_mode: DataRootMode::System,
        effective_mode: DataRootMode::System,
        fallback_active: false,
        fallback_notice_pending: false,
        data_root: data_dir.path().to_path_buf(),
        system_root: data_dir.path().to_path_buf(),
        portable_root: exe_dir.path().to_path_buf(),
    };

    migration::migrate_legacy_sidecars(&state, exe_dir.path());
    let dest = data_dir.path().join(SETTINGS_FILENAME);
    let contents = fs::read_to_string(&dest).expect("read migrated settings");
    assert_eq!(contents, "second");
}

#[test]
fn resolve_data_root_prefers_portable_when_marker_exists() {
    let system_root = tempdir().expect("system root");
    let portable_root = tempdir().expect("portable root");
    fs::write(portable_root.path().join(SETTINGS_FILENAME), b"{}").expect("write marker");

    let context = resolve::DataRootContext {
        system_root: system_root.path().to_path_buf(),
        portable_root: portable_root.path().to_path_buf(),
        exe_dir: portable_root.path().to_path_buf(),
        exe_name: "ffui.exe".to_string(),
    };

    let state = resolve::resolve_data_root_with(&context, |_| true);
    assert_eq!(state.desired_mode, DataRootMode::Portable);
    assert_eq!(state.effective_mode, DataRootMode::Portable);
    assert_eq!(state.data_root, portable_root.path());
}

#[test]
fn resolve_data_root_falls_back_when_portable_not_writable() {
    let system_root = tempdir().expect("system root");
    let portable_root = tempdir().expect("portable root");
    let context = resolve::DataRootContext {
        system_root: system_root.path().to_path_buf(),
        portable_root: portable_root.path().to_path_buf(),
        exe_dir: portable_root.path().to_path_buf(),
        exe_name: "ffui-portable.exe".to_string(),
    };

    let state = resolve::resolve_data_root_with(&context, |_| false);
    assert_eq!(state.desired_mode, DataRootMode::Portable);
    assert_eq!(state.effective_mode, DataRootMode::System);
    assert_eq!(state.data_root, system_root.path());
    assert!(state.fallback_active);
    assert!(state.fallback_notice_pending);
}

#[test]
fn ui_fonts_dir_follows_data_root() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = override_data_root_dir_for_tests(data_dir.path().to_path_buf());

    let fonts_dir = ui_fonts_dir().expect("resolve ui fonts dir for test");
    assert_eq!(fonts_dir, data_dir.path().join(UI_FONTS_DIRNAME));
    assert!(fonts_dir.is_dir());
}

#[test]
fn clear_app_data_root_removes_ui_fonts_dir() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = override_data_root_dir_for_tests(data_dir.path().to_path_buf());

    let fonts_dir = data_dir.path().join(UI_FONTS_DIRNAME);
    fs::create_dir_all(&fonts_dir).expect("create ui-fonts dir");
    fs::write(fonts_dir.join("inter.ttf"), b"ffui").expect("write dummy font");

    clear_app_data_root().expect("clear app data root");
    assert!(!fonts_dir.exists());
}
