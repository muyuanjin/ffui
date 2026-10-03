use super::{AppSettings, SettingsStore};
use serde_json::{Value, json};
use std::fs;

mod compatibility;

fn seed(raw: &Value) {
    fs::write(
        super::super::data_root::settings_path().expect("path"),
        raw.to_string(),
    )
    .expect("seed settings");
}

#[test]
fn settings_snapshot_wire_fields_match_the_frontend_contract() {
    let fields: Value = serde_json::from_str(include_str!(
        "../../../tests/settings-snapshot-contract.json"
    ))
    .expect("snapshot contract");
    let mut wire = fields.clone();
    wire["settings"] = serde_json::to_value(AppSettings::default()).expect("settings");
    let snapshot: super::SettingsSnapshot = serde_json::from_value(wire.clone()).expect("snapshot");
    assert_eq!(
        serde_json::to_value(snapshot).expect("serialized snapshot"),
        wire
    );
}

fn commit(
    store: &mut SettingsStore,
    baseline: &super::SettingsSnapshot,
    next: &AppSettings,
) -> anyhow::Result<super::SettingsSnapshot> {
    store.commit(
        &baseline.settings,
        &baseline.content_id,
        &baseline.data_root_id,
        next,
        true,
    )
}

#[test]
fn unrelated_edits_preserve_unknown_document_metadata_and_nested_fields() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    let raw = json!({"version":2,"futureRoot":{"value":1},"metadata":{"future":"keep"},"settings":{"locale":"en","tools":{"autoDownload":false,"future":{"value":[1,2]}},"queuePresetSelection":{"mode":"byMedia","audio":"music","future":"keep"}}});
    seed(&raw);
    let mut store = SettingsStore::open().expect("store");
    let mut next = store.snapshot().settings;
    next.locale = Some("zh-CN".into());
    next.tools.auto_download = true;
    store.update(&next).expect("save");
    let saved = store.document();
    assert_eq!(saved["futureRoot"], raw["futureRoot"]);
    assert_eq!(saved["metadata"]["future"], "keep");
    assert_eq!(
        saved["settings"]["tools"]["future"],
        raw["settings"]["tools"]["future"]
    );
    assert_eq!(
        saved["settings"]["queuePresetSelection"],
        raw["settings"]["queuePresetSelection"]
    );
    assert_eq!(
        saved["metadata"]["writerVersion"],
        env!("CARGO_PKG_VERSION")
    );
    chrono::DateTime::parse_from_rfc3339(saved["metadata"]["savedAt"].as_str().expect("timestamp"))
        .expect("RFC3339");
    assert_eq!(
        SettingsStore::open()
            .expect("reload")
            .snapshot()
            .settings
            .locale
            .as_deref(),
        Some("zh-CN")
    );
    assert_eq!(fs::read_dir(directory.path()).expect("files").count(), 1);
}

#[test]
fn stale_baselines_merge_disjoint_fields_reject_conflicts_and_accept_same_target() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(&json!({"version":2,"settings":{"locale":"en"}}));
    let mut first = SettingsStore::open().expect("first");
    let mut second = SettingsStore::open().expect("second");
    let original = second.snapshot();
    let mut first_edit = first.snapshot().settings;
    first_edit.locale = Some("zh-CN".into());
    first.update(&first_edit).expect("first edit");
    let mut disjoint = original.settings.clone();
    disjoint.default_queue_preset_id = Some("music".into());
    let merged = commit(&mut second, &original, &disjoint).expect("merge disjoint edits");
    assert_eq!(merged.settings.locale.as_deref(), Some("zh-CN"));
    assert_eq!(
        merged.settings.default_queue_preset_id.as_deref(),
        Some("music")
    );
    let bytes = fs::read(super::super::data_root::settings_path().expect("path")).expect("bytes");
    let mut conflicting = original.settings.clone();
    conflicting.locale = Some("fr".into());
    assert!(
        commit(&mut second, &original, &conflicting)
            .expect_err("conflict")
            .to_string()
            .contains("/locale")
    );
    assert_eq!(
        fs::read(super::super::data_root::settings_path().expect("path")).expect("bytes"),
        bytes
    );
    let same = commit(&mut second, &original, &first_edit).expect("same target");
    assert_eq!(
        same.settings.default_queue_preset_id.as_deref(),
        Some("music")
    );
}

#[test]
fn mode_objects_conflict_as_a_unit_and_invalid_identities_cannot_save() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(
        &json!({"version":2,"settings":{"queuePresetSelection":{"mode":"byMedia","audio":"music"}}}),
    );
    let mut store = SettingsStore::open().expect("store");
    let baseline = store.snapshot();
    let mut latest = baseline.settings.clone();
    latest.queue_preset_selection = Some(super::types::QueuePresetSelection::ByMedia {
        video: Some("video".into()),
        audio: Some("music".into()),
        image: None,
    });
    store.update(&latest).expect("latest");
    let mut stale = baseline.settings.clone();
    stale.queue_preset_selection = Some(super::types::QueuePresetSelection::Unified);
    assert!(
        commit(&mut store, &baseline, &stale)
            .expect_err("mode conflict")
            .to_string()
            .contains("/queuePresetSelection")
    );
    assert!(
        store
            .commit(
                &baseline.settings,
                "",
                &baseline.data_root_id,
                &latest,
                true
            )
            .is_err()
    );
    assert!(
        store
            .commit(
                &baseline.settings,
                &baseline.content_id,
                "different-root",
                &latest,
                true
            )
            .is_err()
    );
    let latest_snapshot = store.snapshot();
    assert!(
        store
            .commit(
                &baseline.settings,
                &latest_snapshot.content_id,
                &latest_snapshot.data_root_id,
                &latest,
                true
            )
            .is_err()
    );
}

#[test]
fn unknown_array_elements_survive_unrelated_saves_and_block_array_replacement() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    let days = json!([{"date":"2026-10-03","activeHoursMask":1,"future":true}]);
    seed(&json!({"version":2,"settings":{"monitor":{"transcodeActivityDays":days}}}));
    let mut store = SettingsStore::open().expect("store");
    assert!(
        store
            .snapshot()
            .unavailable_settings
            .iter()
            .any(|entry| entry.path == "/monitor/transcodeActivityDays")
    );
    let mut next = store.snapshot().settings;
    next.locale = Some("en".into());
    store.update(&next).expect("unrelated edit");
    assert_eq!(
        store.document()["settings"]["monitor"]["transcodeActivityDays"],
        days
    );
    next.monitor
        .as_mut()
        .expect("monitor")
        .transcode_activity_days = Some(vec![]);
    assert!(store.update(&next).is_err());
}

#[test]
fn known_optional_array_fields_remain_editable_and_unknown_optional_objects_cannot_be_deleted() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(
        &json!({"version":2,"settings":{"monitor":{"transcodeActivityDays":[{"date":"2026-10-03","activeHoursMask":1,"updatedAtMs":null}]}}}),
    );
    let mut store = SettingsStore::open().expect("store");
    assert!(store.snapshot().unavailable_settings.is_empty());
    let mut next = store.snapshot().settings;
    next.monitor
        .as_mut()
        .expect("monitor")
        .transcode_activity_days = Some(vec![]);
    store.update(&next).expect("known array edit");
    seed(&json!({"version":2,"settings":{"monitor":{"future":{"value":1}}}}));
    let mut next = store.reload().expect("reload unknown object").settings;
    next.monitor = None;
    assert!(
        store
            .update(&next)
            .expect_err("unknown object deletion")
            .to_string()
            .contains("unsupported data")
    );
    assert_eq!(
        store.document()["settings"]["monitor"]["future"],
        json!({"value":1})
    );
}

#[test]
fn import_preserves_complete_document_and_reset_is_explicit() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(&json!({"version":2,"settings":{"locale":"en","localFuture":1}}));
    let mut store = SettingsStore::open().expect("store");
    store.import_document(json!({"version":2,"futureRoot":[1,2],"metadata":{"source":"keep"},"settings":{"locale":"zh-CN","unknown":[{"value":true}]}})).expect("import");
    let saved = store.document();
    assert_eq!(saved["futureRoot"], json!([1, 2]));
    assert_eq!(saved["metadata"]["source"], "keep");
    assert_eq!(saved["settings"]["localFuture"], 1);
    assert_eq!(saved["settings"]["unknown"], json!([{"value":true}]));
    seed(&json!({"version":999,"settings":{"locale":"fr"}}));
    assert!(
        store
            .reload()
            .expect("read-only view")
            .unavailable_settings
            .iter()
            .any(|entry| entry.path.is_empty())
    );
    let reset = SettingsStore::reset().expect("explicit reset");
    assert!(reset.snapshot().unavailable_settings.is_empty());
    assert_eq!(reset.document()["version"], 2);
    assert_eq!(reset.document()["settings"], json!({}));
}

#[test]
fn settings_store_child_process_writer() {
    let Some(directory) = std::env::var_os("FFUI_SETTINGS_TEST_DIRECTORY") else {
        return;
    };
    let directory = std::path::PathBuf::from(directory);
    let field = std::env::var("FFUI_SETTINGS_TEST_FIELD").expect("field");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.clone());
    let mut store = SettingsStore::open().expect("child store");
    let baseline = store.snapshot();
    fs::write(directory.join(format!("{field}.ready")), b"ready").expect("ready");
    let started = std::time::Instant::now();
    while !directory.join("release").exists() {
        assert!(
            started.elapsed().as_secs() < 10,
            "parent did not release child writer"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let mut next = baseline.settings.clone();
    if field == "locale" {
        next.locale = Some("zh-CN".into());
    } else {
        next.default_queue_preset_id = Some("music".into());
    }
    commit(&mut store, &baseline, &next).expect("child commit");
}

#[test]
fn unknown_footer_values_are_read_only_before_normalization_discards_them() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    let footer = json!({"layout":"future-layout","order":["fps","future-item"]});
    seed(&json!({"version":2,"settings":{"presetCardFooter":footer}}));
    let mut store = SettingsStore::open().expect("store");
    assert_eq!(store.snapshot().unavailable_settings.len(), 2);
    let mut next = store.snapshot().settings;
    next.locale = Some("en".into());
    store.update(&next).expect("unrelated edit");
    assert_eq!(store.document()["settings"]["presetCardFooter"], footer);
    next.preset_card_footer = Some(super::types::PresetCardFooterSettings {
        show_fps: false,
        ..Default::default()
    });
    assert!(store.update(&next).is_err());
}

#[test]
fn clearing_a_mode_container_cannot_discard_unknown_fields() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    let selection = json!({"mode":"byMedia","audio":"music","future":"keep"});
    seed(&json!({"version":2,"settings":{"queuePresetSelection":selection}}));
    let mut store = SettingsStore::open().expect("store");
    let mut next = store.snapshot().settings;
    next.queue_preset_selection = None;
    assert!(store.update(&next).is_err());
    assert_eq!(
        store.document()["settings"]["queuePresetSelection"],
        selection
    );
}

#[test]
fn independent_processes_merge_disjoint_edits_from_the_same_snapshot() {
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(&json!({"version":2,"settings":{"locale":"en","future":[1,2]}}));
    let mut children: Vec<_> = ["locale", "preset"]
        .into_iter()
        .map(|field| {
            std::process::Command::new(std::env::current_exe().expect("test binary"))
                .args([
                    "--exact",
                    "ffui_core::settings::store_tests::settings_store_child_process_writer",
                    "--test-threads=1",
                ])
                .env("FFUI_SETTINGS_TEST_DIRECTORY", directory.path())
                .env("FFUI_SETTINGS_TEST_FIELD", field)
                .stdout(std::process::Stdio::null())
                .spawn()
                .expect("child writer")
        })
        .collect();
    let started = std::time::Instant::now();
    while !["locale.ready", "preset.ready"]
        .iter()
        .all(|name| directory.path().join(name).exists())
    {
        if started.elapsed().as_secs() >= 10 {
            for child in &mut children {
                drop(child.kill());
                drop(child.wait());
            }
            panic!("child writers did not load their snapshots");
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    fs::write(directory.path().join("release"), b"release").expect("release writers");
    for child in &mut children {
        assert!(child.wait().expect("child completion").success());
    }
    let loaded = SettingsStore::open().expect("merged settings");
    assert_eq!(loaded.snapshot().settings.locale.as_deref(), Some("zh-CN"));
    assert_eq!(
        loaded
            .snapshot()
            .settings
            .default_queue_preset_id
            .as_deref(),
        Some("music")
    );
    assert_eq!(loaded.document()["settings"]["future"], json!([1, 2]));
}

#[cfg(windows)]
#[test]
fn failed_atomic_write_does_not_publish_store_or_engine_settings() {
    use crate::sync_ext::MutexExt;
    use std::os::windows::fs::OpenOptionsExt;
    let directory = tempfile::tempdir().expect("directory");
    let _guard = super::super::data_root::override_data_root_dir_for_tests(directory.path().into());
    seed(&json!({"version":2,"settings":{"locale":"en","onboardingCompleted":true}}));
    let engine = super::super::engine::TranscodingEngine::new().expect("engine");
    let mut store = SettingsStore::open().expect("store");
    let baseline = store.snapshot();
    let path = super::super::data_root::settings_path().expect("path");
    let bytes = fs::read(&path).expect("bytes");
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .expect("share lock");
    let mut next = baseline.settings.clone();
    next.locale = Some("zh-CN".into());
    assert!(commit(&mut store, &baseline, &next).is_err());
    assert_eq!(store.snapshot().content_id, baseline.content_id);
    assert!(
        engine
            .commit_settings(
                next,
                baseline.settings,
                baseline.content_id,
                baseline.data_root_id,
                true
            )
            .is_err()
    );
    assert_eq!(engine.settings().locale.as_deref(), Some("en"));
    assert!(
        engine
            .inner
            .update_settings(|settings| settings.locale = Some("fr".into()))
            .is_err()
    );
    assert_eq!(
        engine
            .inner
            .state
            .lock_unpoisoned()
            .settings
            .locale
            .as_deref(),
        Some("en")
    );
    assert_eq!(fs::read(&path).expect("original bytes"), bytes);
    drop(locked);
}
