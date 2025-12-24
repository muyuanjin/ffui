use super::*;

#[test]
fn presets_snapshot_is_reused_and_cow_on_mutation() {
    use std::time::{SystemTime, UNIX_EPOCH};

    let tmp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let data_root = tmp_dir.join(format!("ffui_test_data_root_{timestamp}"));
    let _ = std::fs::create_dir_all(&data_root);
    let data_root_guard = crate::ffui_core::override_data_root_dir_for_tests(data_root);

    let engine = make_engine_with_preset();

    let before = engine.presets();
    let before_second = engine.presets();
    assert!(
        std::sync::Arc::ptr_eq(&before, &before_second),
        "presets snapshot should be reused when unchanged"
    );

    let mut preset = before
        .iter()
        .find(|p| p.id == "preset-1")
        .cloned()
        .expect("test preset must exist");
    preset.name = format!("{} (updated)", preset.name);

    let after = engine
        .save_preset(preset.clone())
        .expect("save_preset should succeed");

    assert!(
        !std::sync::Arc::ptr_eq(&before, &after),
        "mutation should produce a new presets snapshot when a previous snapshot is still referenced"
    );

    let original = before
        .iter()
        .find(|p| p.id == "preset-1")
        .expect("original preset must exist");
    assert_ne!(
        original.name, preset.name,
        "original snapshot must not be mutated in-place when shared"
    );

    let updated = after
        .iter()
        .find(|p| p.id == "preset-1")
        .expect("updated preset must exist");
    assert_eq!(
        updated.name, preset.name,
        "updated snapshot should reflect the mutation"
    );
    drop(data_root_guard);
}
