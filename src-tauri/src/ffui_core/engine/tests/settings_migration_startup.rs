use super::*;
use serde_json::json;
use std::fs;
use tempfile::tempdir;

#[test]
fn engine_startup_preserves_loaded_settings_when_legacy_rewrite_fails() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    // Simulate v0.3.0-style unversioned settings. v0.3.1 rewrites these into a
    // versioned envelope on load; ensure startup does not fall back to defaults
    // if the rewrite step fails.
    let legacy = json!({
        "locale": "en",
        "onboardingCompleted": true
    });
    fs::write(&path, legacy.to_string()).expect("write legacy settings");

    // Force the migration rewrite to fail (temp file creation will fail).
    let tmp_path = path.with_extension("tmp");
    fs::create_dir_all(&tmp_path).expect("create tmp path as directory");

    let engine = TranscodingEngine::new().expect("engine should start");
    let loaded = engine.settings();
    assert_eq!(loaded.locale.as_deref(), Some("en"));
    assert!(
        loaded.onboarding_completed,
        "startup must preserve onboardingCompleted from the legacy settings file"
    );
}
