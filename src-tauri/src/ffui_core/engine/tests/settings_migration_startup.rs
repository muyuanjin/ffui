use super::*;
use std::fs;
use tempfile::tempdir;

#[test]
#[cfg(windows)]
fn engine_startup_preserves_loaded_settings_when_legacy_rewrite_fails() {
    use serde_json::json;
    use std::os::windows::fs::OpenOptionsExt;
    let data_dir = tempdir().expect("temp data dir");
    let _guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_dir.path().to_path_buf(),
    );
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");

    let legacy = json!({
        "locale": "en",
        "onboardingCompleted": true
    });
    fs::write(&path, legacy.to_string()).expect("write legacy settings");

    let file_lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .expect("read-only share lock");
    assert!(settings::save_settings(&AppSettings::default()).is_err());

    let engine = TranscodingEngine::new().expect("engine should start");
    let loaded = engine.settings();
    assert_eq!(loaded.locale.as_deref(), Some("en"));
    assert!(
        loaded.onboarding_completed,
        "startup must preserve onboardingCompleted from the legacy settings file"
    );
    assert_eq!(
        fs::read_to_string(&path).expect("legacy unchanged"),
        legacy.to_string()
    );
    drop(file_lock);
}

#[test]
fn engine_settings_load_failure_rejects_reads_and_writes_then_reloads_repaired_disk() {
    let data_dir = tempdir().expect("temp data dir");
    let _guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(data_dir.path().into());
    let path = crate::ffui_core::data_root::settings_path().expect("settings path");
    fs::write(&path, "broken JSON").expect("broken settings");
    let engine = TranscodingEngine::new().expect("engine remains available for diagnostics");
    assert!(engine.checked_settings().is_err());
    assert!(engine.save_settings(AppSettings::default()).is_err());
    assert!(engine.inner.persist_current_settings().is_err());
    assert_eq!(
        fs::read_to_string(&path).expect("preserved settings"),
        "broken JSON"
    );
    let recovered = AppSettings {
        default_queue_preset_id: Some("custom-audio".into()),
        ..Default::default()
    };
    fs::write(
        &path,
        serde_json::json!({"version": 2, "settings": recovered}).to_string(),
    )
    .expect("external repair");
    let loaded = engine
        .checked_settings()
        .expect("retry loads repaired settings");
    assert_eq!(
        loaded.default_queue_preset_id,
        recovered.default_queue_preset_id
    );
    assert!(
        engine
            .inner
            .state
            .lock_unpoisoned()
            .settings_load_error
            .is_none()
    );
}

#[test]
fn unsupported_configuration_cannot_execute_manual_or_restored_jobs() {
    let engine = TranscodingEngine::new_for_tests();
    let snapshot = settings::SettingsStore::inspect_document(&serde_json::json!({"version":2,"settings":{"queuePresetSelection":{"mode":"future-mode"}}})).expect("partial settings");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.settings = snapshot.settings;
        state.unavailable_settings = snapshot.unavailable_settings;
    }
    let job = worker::enqueue_transcode_job(
        &engine.inner,
        "unavailable-input.wav".into(),
        JobType::Audio,
        JobSource::Manual,
        1.0,
        Some("pcm".into()),
        "missing".into(),
    );
    assert!(
        matches!(job.execution, Some(crate::ffui_core::domain::JobExecution::Invalid { ref reason }) if reason.contains("queuePresetSelection"))
    );
    let tools = settings::SettingsStore::inspect_document(&serde_json::json!({"version":2,"settings":{"tools":{"autoDownload":false},"parallelismMode":"future-mode"}})).expect("partial tools");
    engine.inner.state.lock_unpoisoned().unavailable_settings = tools.unavailable_settings;
    job_runner::process_transcode_job(&engine.inner, &job.id).expect("explicit failure");
    let state = engine.inner.state.lock_unpoisoned();
    let failed = state.jobs.get(&job.id).expect("job");
    assert_eq!(failed.status, JobStatus::Failed);
    assert!(
        failed
            .failure_reason
            .as_deref()
            .expect("diagnostic")
            .contains("parallelismMode")
    );
}
