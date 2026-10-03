use super::*;

#[test]
fn media_defaults_and_output_preferences_survive_disk_reload_and_last_good_recovery() {
    let directory = tempdir().expect("data directory");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let contract: Value = serde_json::from_str(include_str!(
        "../../../../tests/settings-media-selection-contract.json"
    ))
    .expect("settings contract");
    let mut settings: AppSettings = serde_json::from_value(contract.clone()).expect("settings");
    settings.batch_compress_defaults.output_policy = settings.queue_output_policy.clone();
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");
    for mode in [
        contract["queuePresetSelection"].clone(),
        json!({"mode": "unified"}),
    ] {
        settings.queue_preset_selection =
            Some(serde_json::from_value(mode.clone()).expect("selection"));
        save_settings(&settings).expect("save settings");
        let saved: Value = serde_json::from_slice(&fs::read(&path).expect("read settings"))
            .expect("versioned settings");
        assert_eq!(saved["version"], 2);
        for recovered in [false, true] {
            if recovered {
                fs::write(&path, b"{interrupted").expect("corrupt primary file");
            }
            let loaded = load_settings().expect("load settings");
            let value = serde_json::to_value(&loaded).expect("loaded settings JSON");
            assert_eq!(value["queuePresetSelection"], mode);
            for (key, expected) in contract.as_object().expect("contract object") {
                if key != "queuePresetSelection" {
                    assert_eq!(&value[key], expected, "persisted field {key}");
                }
            }
            assert_eq!(
                loaded.batch_compress_defaults.output_policy,
                settings.queue_output_policy
            );
        }
    }
}
