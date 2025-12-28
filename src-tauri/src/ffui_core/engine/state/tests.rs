use super::*;
use crate::ffui_core::JobStatus;
use crate::test_support::make_transcode_job_for_tests;
use tempfile::tempdir;

fn make_queue_order_test_state() -> EngineState {
    let mut state = EngineState::new(Vec::new(), AppSettings::default());
    state.queue.push_back("b".to_string());
    state.queue.push_back("a".to_string());

    state.jobs.insert(
        "c".to_string(),
        make_transcode_job_for_tests("c", JobStatus::Queued, 0.0, None),
    );
    state.jobs.insert(
        "a".to_string(),
        make_transcode_job_for_tests("a", JobStatus::Queued, 0.0, None),
    );
    state.jobs.insert(
        "b".to_string(),
        make_transcode_job_for_tests("b", JobStatus::Queued, 0.0, None),
    );
    state
}

fn assert_queue_order_snapshot<J: QueueOrderSortable>(jobs: &[J]) {
    let ids: Vec<&str> = jobs.iter().map(super::QueueOrderSortable::id_str).collect();
    assert_eq!(ids, vec!["b", "a", "c"]);

    assert_eq!(jobs[0].queue_order(), Some(0));
    assert_eq!(jobs[1].queue_order(), Some(1));
    assert_eq!(jobs[2].queue_order(), None);
}

#[test]
fn snapshot_queue_state_sorts_jobs_by_queue_order_then_id() {
    let state = make_queue_order_test_state();
    let snapshot = snapshot_queue_state_from_locked_state(&state);
    assert_queue_order_snapshot(&snapshot.jobs);

    let json = serde_json::to_value(&snapshot).expect("QueueState serializes");
    let jobs = json
        .get("jobs")
        .and_then(|v| v.as_array())
        .expect("jobs array present");
    assert_eq!(jobs[0].get("id").and_then(|v| v.as_str()), Some("b"));
    assert_eq!(
        jobs[0]
            .get("queueOrder")
            .and_then(serde_json::Value::as_u64),
        Some(0)
    );
}

#[test]
fn snapshot_queue_state_lite_sorts_jobs_by_queue_order_then_id() {
    let state = make_queue_order_test_state();
    let mut state = state;
    let snapshot = snapshot_queue_state_lite_from_locked_state(&mut state);
    assert_queue_order_snapshot(&snapshot.jobs);
}

#[test]
fn snapshot_queue_state_lite_preserves_snapshot_revision() {
    let mut state = make_queue_order_test_state();
    state.queue_snapshot_revision = 42;
    let s1 = snapshot_queue_state_lite_from_locked_state(&mut state);
    let s2 = snapshot_queue_state_lite_from_locked_state(&mut state);
    assert_eq!(s1.snapshot_revision, 42);
    assert_eq!(s2.snapshot_revision, 42);
}

#[test]
fn snapshot_queue_state_lite_does_not_mutate_locked_job_queue_order() {
    let mut state = make_queue_order_test_state();
    assert_eq!(state.jobs.get("b").expect("job b exists").queue_order, None);
    let _ = snapshot_queue_state_lite_from_locked_state(&mut state);
    assert_eq!(state.jobs.get("b").expect("job b exists").queue_order, None);
}

#[test]
fn snapshot_queue_state_lite_clears_legacy_video_preview_paths() {
    let data_root = tempdir().expect("create temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let mut state = EngineState::new(Vec::new(), AppSettings::default());
    state.settings.preview_capture_percent = 25;

    let mut job = make_transcode_job_for_tests("v1", JobStatus::Queued, 0.0, None);
    job.input_path = Some("C:/input.mp4".to_string());
    job.preview_path = Some("C:/legacy-preview.jpg".to_string());
    state.jobs.insert(job.id.clone(), job);

    let snapshot = snapshot_queue_state_lite_from_locked_state(&mut state);
    let lite = snapshot
        .jobs
        .iter()
        .find(|j| j.id == "v1")
        .expect("job present");
    assert!(
        lite.preview_path.is_none(),
        "legacy preview path should be hidden so the UI triggers ensure_job_preview"
    );
}
