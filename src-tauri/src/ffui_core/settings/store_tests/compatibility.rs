use super::*;
use crate::ffui_core::domain::{OutputContainerPolicy, PreserveFileTimesPolicy};

#[test]
fn untagged_time_options_preserve_unknown_fields_and_reject_container_replacement() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard =
        super::super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    for policy in ["queueOutputPolicy", "batchCompressDefaults/outputPolicy"] {
        let mut raw = json!({"version":2,"settings":{}});
        let times = json!({"created":true,"future":{"value":123}});
        if policy == "queueOutputPolicy" {
            raw["settings"][policy] = json!({"preserveFileTimes":times});
        } else {
            raw["settings"]["batchCompressDefaults"] =
                serde_json::to_value(AppSettings::default().batch_compress_defaults)
                    .expect("batch defaults");
            raw["settings"]["batchCompressDefaults"]["outputPolicy"] =
                json!({"preserveFileTimes":times});
        }
        seed(&raw);
        let mut store = SettingsStore::open().expect("store");
        let mut next = store.snapshot().settings;
        next.locale = Some("en".into());
        store.update(&next).expect("unrelated save");
        let pointer = format!("/settings/{policy}/preserveFileTimes");
        assert_eq!(store.document().pointer(&pointer), Some(&times));
        if policy == "queueOutputPolicy" {
            next.queue_output_policy.preserve_file_times = PreserveFileTimesPolicy::Bool(false);
        } else {
            next.batch_compress_defaults
                .output_policy
                .preserve_file_times = PreserveFileTimesPolicy::Bool(false);
        }
        let before = fs::read(super::super::super::data_root::settings_path().expect("path"))
            .expect("bytes");
        assert!(
            store
                .update(&next)
                .expect_err("unsafe replacement")
                .to_string()
                .contains("unsupported data")
        );
        assert_eq!(
            fs::read(super::super::super::data_root::settings_path().expect("path"))
                .expect("bytes"),
            before
        );
        assert_eq!(store.document().pointer(&pointer), Some(&times));
    }
}

#[test]
fn known_time_options_can_be_disabled_without_unknown_data() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard =
        super::super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(
        &json!({"version":2,"settings":{"queueOutputPolicy":{"preserveFileTimes":{"created":true,"modified":false,"accessed":false}}}}),
    );
    let mut store = SettingsStore::open().expect("store");
    let mut next = store.snapshot().settings;
    next.queue_output_policy.preserve_file_times = PreserveFileTimesPolicy::Bool(false);
    store.update(&next).expect("disable known options");
    assert!(
        !SettingsStore::open()
            .expect("reload")
            .snapshot()
            .settings
            .queue_output_policy
            .preserve_file_times
            .any()
    );
}

#[test]
fn sparse_new_schema_import_migrates_retained_legacy_output_policies_before_merge() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard =
        super::super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    for version in [0, 1] {
        let mut raw = json!({"version":version,"settings":{"queueOutputPolicy":{"container":{"mode":"force","format":"mp3"}}}});
        raw["settings"]["batchCompressDefaults"] =
            serde_json::to_value(AppSettings::default().batch_compress_defaults)
                .expect("batch defaults");
        raw["settings"]["batchCompressDefaults"]["outputPolicy"] =
            json!({"container":{"mode":"force","format":"png"}});
        seed(&raw);
        let mut store = SettingsStore::open().expect("store");
        let before = store.snapshot().settings;
        let imported = store
            .import_document(json!({"version":2,"settings":{"locale":"en"}}))
            .expect("import");
        assert_eq!(
            imported.settings.queue_output_policy.container,
            before.queue_output_policy.container
        );
        assert_eq!(
            imported
                .settings
                .batch_compress_defaults
                .output_policy
                .container,
            before.batch_compress_defaults.output_policy.container
        );
        assert!(matches!(
            imported.settings.queue_output_policy.container,
            OutputContainerPolicy::ByMedia { .. }
        ));
        assert_eq!(
            SettingsStore::open()
                .expect("reload")
                .snapshot()
                .settings
                .queue_output_policy
                .container,
            before.queue_output_policy.container
        );
    }
}

#[test]
fn imported_policy_uses_its_own_schema_and_preserves_unrelated_target_options() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard =
        super::super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(
        &json!({"version":1,"settings":{"queueOutputPolicy":{"container":{"mode":"force","format":"mp3"},"directory":{"mode":"fixed","directory":"saved-output"}}}}),
    );
    let mut store = SettingsStore::open().expect("store");
    let imported = store.import_document(json!({"version":2,"settings":{"queueOutputPolicy":{"container":{"mode":"force","format":"wav"}}}})).expect("explicit override");
    assert_eq!(
        imported.settings.queue_output_policy.container,
        OutputContainerPolicy::Force {
            format: "wav".into()
        }
    );
    assert_eq!(
        store.document()["settings"]["queueOutputPolicy"]["directory"]["directory"],
        "saved-output"
    );
}
