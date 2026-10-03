use super::*;
use crate::test_support::make_ffmpeg_preset_for_tests;
use serde_json::json;
use std::fs;

fn preset_values(presets: &[crate::ffui_core::FFmpegPreset]) -> serde_json::Value {
    serde_json::to_value(presets).expect("preset snapshot")
}

fn bundle() -> ConfigBundle {
    ConfigBundle {
        schema_version: 2,
        app_version: "0.3.6".into(),
        exported_at_ms: 0,
        settings_document: json!({"version":2,"settings":{"locale":"en"}}),
        presets: vec![make_ffmpeg_preset_for_tests("imported")],
    }
}

#[test]
fn failed_preset_import_keeps_runtime_and_settings_unpublished() {
    let directory = tempfile::tempdir().expect("root");
    let _guard = crate::ffui_core::override_data_root_dir_for_tests(directory.path().into());
    let engine = TranscodingEngine::new_for_tests();
    let original = vec![make_ffmpeg_preset_for_tests("original")];
    engine
        .replace_presets(original.clone())
        .expect("seed presets");
    let before = engine.settings_snapshot().expect("settings");
    let preset_path = crate::ffui_core::presets_path().expect("preset path");
    let bytes = fs::read(&preset_path).expect("presets");
    fs::remove_file(&preset_path).expect("remove seed file");
    fs::create_dir(&preset_path).expect("block replacement");
    fs::write(preset_path.join("retained.json"), &bytes).expect("retained bytes");
    assert!(import_bundle(&engine, bundle()).is_err());
    assert_eq!(preset_values(&engine.presets()), preset_values(&original));
    assert_eq!(
        fs::read(preset_path.join("retained.json")).expect("retained"),
        bytes
    );
    assert_eq!(
        engine.settings_snapshot().expect("settings").content_id,
        before.content_id
    );
    assert!(engine.delete_preset("original").is_err());
    assert_eq!(preset_values(&engine.presets()), preset_values(&original));
    assert!(engine.reorder_presets(&["original".into()]).is_err());
    assert_eq!(preset_values(&engine.presets()), preset_values(&original));
}

#[test]
fn failed_settings_import_restores_previous_presets() {
    let directory = tempfile::tempdir().expect("root");
    let _guard = crate::ffui_core::override_data_root_dir_for_tests(directory.path().into());
    let engine = TranscodingEngine::new_for_tests();
    let original = vec![make_ffmpeg_preset_for_tests("original")];
    engine
        .replace_presets(original.clone())
        .expect("seed presets");
    let path = crate::ffui_core::settings_path().expect("settings path");
    let settings = serde_json::to_vec(&json!({"version":99,"settings":{"locale":"zh-CN"}}))
        .expect("settings bytes");
    fs::write(&path, &settings).expect("read-only schema");
    assert!(
        import_bundle(&engine, bundle())
            .expect_err("settings failure")
            .contains("read-only")
    );
    assert_eq!(preset_values(&engine.presets()), preset_values(&original));
    assert_eq!(
        preset_values(&crate::ffui_core::load_presets().expect("persisted presets")),
        preset_values(&original)
    );
    assert_eq!(fs::read(path).expect("settings bytes"), settings);
}

#[test]
fn successful_import_publishes_both_confirmed_owners() {
    let directory = tempfile::tempdir().expect("root");
    let _guard = crate::ffui_core::override_data_root_dir_for_tests(directory.path().into());
    let engine = TranscodingEngine::new_for_tests();
    engine.replace_presets(Vec::new()).expect("seed file");
    let imported = import_bundle(&engine, bundle()).expect("import");
    assert_eq!(imported.preset_count, 1);
    assert_eq!(imported.settings.settings.locale.as_deref(), Some("en"));
    assert_eq!(engine.presets()[0].id, "imported");
    assert_eq!(
        preset_values(&crate::ffui_core::load_presets().expect("disk presets")),
        preset_values(&engine.presets())
    );
    assert_eq!(
        engine.settings_snapshot().expect("settings").content_id,
        imported.settings.content_id
    );
}
