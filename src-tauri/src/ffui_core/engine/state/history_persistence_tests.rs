use super::*;
use crate::ffui_core::engine::{TranscodingEngine, state_persist};
use crate::test_support::make_transcode_job_for_tests;

fn write_history(path: &std::path::Path) -> Vec<TranscodeJob> {
    let jobs: Vec<_> = [
        JobStatus::Completed,
        JobStatus::Failed,
        JobStatus::Cancelled,
        JobStatus::Skipped,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, status)| {
        make_transcode_job_for_tests(&format!("history-{index}"), status, 100.0, None)
    })
    .collect();
    let snapshot = QueueStateLite {
        snapshot_revision: 9,
        jobs: jobs
            .iter()
            .map(crate::ffui_core::TranscodeJobLite::from)
            .collect(),
    };
    std::fs::write(path, serde_json::to_vec(&snapshot).expect("history JSON"))
        .expect("history file");
    jobs
}

#[test]
fn startup_settings_saves_and_exit_cannot_replace_history_before_recovery() {
    let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
    state_persist::reset_queue_persist_state_for_tests();
    let directory = tempfile::tempdir().expect("data directory");
    let _data_root =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = directory.path().join("ffui.queue-state.json");
    let _sidecar = crate::ffui_core::override_queue_state_sidecar_path_for_tests(path.clone());
    let history = write_history(&path);
    let original = std::fs::read(&path).expect("original history");
    let engine = TranscodingEngine::new_for_tests();
    engine.inner.state.lock_unpoisoned().queue_recovery_pending = true;
    engine
        .save_settings(AppSettings {
            queue_persistence_mode: QueuePersistenceMode::CrashRecoveryLite,
            ..Default::default()
        })
        .expect("startup preferences");
    persist_queue_state_lite_best_effort(&engine.inner);
    assert!(engine.force_persist_queue_state_lite_now().is_err());
    assert_eq!(std::fs::read(&path).expect("protected history"), original);
    restore_jobs_from_persisted_queue(&engine.inner);
    assert_eq!(engine.queue_state().jobs.len(), history.len());
    assert!(engine.queue_restore_error().is_none());
    let revision = engine.inner.state.lock_unpoisoned().queue_snapshot_revision;
    assert!(revision > 9);
    assert_eq!(
        state_persist::peek_last_persisted_queue_state_lite()
            .expect("merged snapshot accepted")
            .snapshot_revision,
        revision
    );
    engine
        .force_persist_queue_state_lite_now()
        .expect("recovered snapshot");
    let restarted = TranscodingEngine::new_for_tests();
    restarted
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_persistence_mode = QueuePersistenceMode::CrashRecoveryLite;
    restore_jobs_from_persisted_queue(&restarted.inner);
    assert!(
        restarted
            .inner
            .state
            .lock_unpoisoned()
            .queue_snapshot_revision
            > revision
    );
    for job in history {
        assert_eq!(
            restarted
                .job_detail(&job.id)
                .expect("restored history")
                .status,
            job.status
        );
    }
}

#[test]
fn unreadable_history_reports_recovery_error_and_refuses_empty_replacement() {
    let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
    state_persist::reset_queue_persist_state_for_tests();
    let directory = tempfile::tempdir().expect("data directory");
    let _data_root =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = directory.path().join("ffui.queue-state.json");
    let _sidecar = crate::ffui_core::override_queue_state_sidecar_path_for_tests(path.clone());
    let original = b"{unreadable history";
    std::fs::write(&path, original).expect("unreadable queue");
    let engine = TranscodingEngine::new_for_tests();
    restore_jobs_from_persisted_queue(&engine.inner);
    assert!(
        engine
            .queue_restore_error()
            .expect("diagnostic")
            .contains("Failed to decode queue history")
    );
    notify_queue_listeners(&engine.inner);
    persist_queue_state_lite_best_effort(&engine.inner);
    assert!(engine.force_persist_queue_state_lite_now().is_err());
    assert_eq!(std::fs::read(&path).expect("protected queue"), original);
    write_history(&path);
    engine
        .inner
        .state
        .lock_unpoisoned()
        .settings
        .queue_persistence_mode = QueuePersistenceMode::CrashRecoveryLite;
    restore_jobs_from_persisted_queue(&engine.inner);
    assert!(engine.queue_restore_error().is_none());
    assert_eq!(engine.queue_state().jobs.len(), 4);
}

#[test]
fn failed_settings_load_does_not_filter_history_using_placeholder_preferences() {
    let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
    state_persist::reset_queue_persist_state_for_tests();
    let directory = tempfile::tempdir().expect("data directory");
    let _data_root =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(directory.path().into());
    let path = directory.path().join("ffui.queue-state.json");
    let _sidecar = crate::ffui_core::override_queue_state_sidecar_path_for_tests(path.clone());
    write_history(&path);
    let original = std::fs::read(&path).expect("original history");
    let engine = TranscodingEngine::new_for_tests();
    engine.inner.state.lock_unpoisoned().settings_load_error =
        Some("incompatible preferences".into());
    restore_jobs_from_persisted_queue(&engine.inner);
    assert!(
        engine
            .queue_restore_error()
            .expect("diagnostic")
            .contains("incompatible preferences")
    );
    assert!(engine.force_persist_queue_state_lite_now().is_err());
    notify_queue_listeners(&engine.inner);
    assert_eq!(std::fs::read(&path).expect("protected history"), original);
}
