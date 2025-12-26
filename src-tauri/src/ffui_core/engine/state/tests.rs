use super::*;
use crate::ffui_core::JobStatus;
use crate::test_support::make_transcode_job_for_tests;

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
fn snapshot_queue_state_lite_increments_snapshot_revision() {
    let mut state = make_queue_order_test_state();
    let s1 = snapshot_queue_state_lite_from_locked_state(&mut state);
    let s2 = snapshot_queue_state_lite_from_locked_state(&mut state);
    assert!(s2.snapshot_revision > s1.snapshot_revision);
}

#[test]
fn snapshot_queue_state_lite_does_not_mutate_locked_job_queue_order() {
    let mut state = make_queue_order_test_state();
    assert_eq!(state.jobs.get("b").expect("job b exists").queue_order, None);
    let _ = snapshot_queue_state_lite_from_locked_state(&mut state);
    assert_eq!(state.jobs.get("b").expect("job b exists").queue_order, None);
}
