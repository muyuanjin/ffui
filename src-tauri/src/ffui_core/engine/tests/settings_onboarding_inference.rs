use super::*;
use serde_json::{Value, json};
use std::fs;
use tempfile::tempdir;

#[test]
fn engine_startup_infers_onboarding_completed_when_smart_presets_exist() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );

    let settings_path = crate::ffui_core::data_root::settings_path().expect("settings path");
    let presets_path = crate::ffui_core::data_root::presets_path().expect("presets path");

    // Settings without onboardingCompleted marker (the default is false).
    let settings = json!({
        "locale": "zh-CN"
    });
    fs::write(&settings_path, settings.to_string()).expect("write settings");

    // Presets containing at least one smart preset should imply onboarding is done.
    let mut preset = make_test_preset();
    preset.is_smart_preset = Some(true);
    let presets_json = serde_json::to_string_pretty(&vec![preset]).expect("serialize presets");
    fs::write(&presets_path, presets_json).expect("write presets");

    let engine = TranscodingEngine::new().expect("engine should start");
    assert!(
        engine.settings().onboarding_completed,
        "engine should infer onboardingCompleted when smart presets exist"
    );

    let rewritten: Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).expect("read settings"))
            .expect("parse settings JSON");
    assert_eq!(
        rewritten
            .get("settings")
            .and_then(Value::as_object)
            .and_then(|settings| settings.get("onboardingCompleted"))
            .and_then(Value::as_bool),
        Some(true),
        "inferred onboardingCompleted must be persisted to disk"
    );
}
