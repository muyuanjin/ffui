use super::*;
use crate::ffui_core::domain::{JobSource, JobType, TranscodeJobLite};
use std::time::Duration;

fn make_job(id: &str, status: JobStatus) -> TranscodeJob {
    TranscodeJob {
        id: id.to_string(),
        filename: "C:/videos/test.mp4".to_string(),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: None,
        original_size_mb: 10.0,
        original_codec: None,
        preset_id: "preset-1".to_string(),
        status,
        progress: 0.0,
        start_time: None,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        skip_reason: None,
        input_path: None,
        output_path: None,
        ffmpeg_command: None,
        media_info: None,
        estimated_seconds: None,
        preview_path: None,
        log_tail: None,
        failure_reason: None,
        batch_id: None,
        wait_metadata: None,
    }
}

fn make_state_lite(jobs: Vec<TranscodeJob>) -> QueueStateLite {
    QueueStateLite {
        jobs: jobs
            .into_iter()
            .map(|job| TranscodeJobLite::from(&job))
            .collect(),
    }
}

#[test]
fn detects_newly_terminal_jobs_when_status_transitions_to_completed() {
    let prev = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
    let current = make_state_lite(vec![make_job("job-1", JobStatus::Completed)]);

    assert!(
        has_newly_terminal_jobs(Some(&prev), &current),
        "transition from Processing to Completed should be treated as newly terminal",
    );
}

#[test]
fn ignores_jobs_that_were_already_terminal() {
    let prev = make_state_lite(vec![make_job("job-1", JobStatus::Completed)]);
    let current = make_state_lite(vec![make_job("job-1", JobStatus::Completed)]);

    assert!(
        !has_newly_terminal_jobs(Some(&prev), &current),
        "terminal -> terminal transitions should not be treated as newly terminal",
    );
}

#[test]
fn treats_terminal_jobs_as_new_when_no_previous_snapshot_exists() {
    let current = make_state_lite(vec![make_job("job-1", JobStatus::Completed)]);
    assert!(
        has_newly_terminal_jobs(None, &current),
        "a terminal job in the first snapshot should be considered newly terminal",
    );
}

#[test]
fn ignores_purely_non_terminal_changes() {
    let prev = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
    let current = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);

    assert!(
        !has_newly_terminal_jobs(Some(&prev), &current),
        "no change in non-terminal status should not trigger newly-terminal detection",
    );
}

#[test]
fn debounced_persistence_flushes_after_burst_ends() {
    let _guard = PERSIST_TEST_MUTEX.lock().expect("PERSIST_TEST_MUTEX poisoned");

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    QUEUE_PERSIST_WRITE_COUNT.store(0, Ordering::SeqCst);

    let s1 = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
    persist_queue_state_lite(&s1);
    assert_eq!(QUEUE_PERSIST_WRITE_COUNT.load(Ordering::SeqCst), 1);

    // Within debounce window, should not write immediately.
    let s2 = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
    persist_queue_state_lite(&s2);
    assert_eq!(QUEUE_PERSIST_WRITE_COUNT.load(Ordering::SeqCst), 1);

    // After debounce, background thread should flush without needing a third call.
    let deadline = Instant::now() + Duration::from_millis(QUEUE_PERSIST_DEBOUNCE_MS + 200);
    while Instant::now() < deadline {
        if QUEUE_PERSIST_WRITE_COUNT.load(Ordering::SeqCst) >= 2 {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(
        QUEUE_PERSIST_WRITE_COUNT.load(Ordering::SeqCst) >= 2,
        "expected a background flush write after debounce window"
    );

    let _ = fs::remove_file(tmp);
}

#[test]
fn debounced_persistence_limits_write_frequency_under_bursts() {
    let _guard = PERSIST_TEST_MUTEX.lock().expect("PERSIST_TEST_MUTEX poisoned");

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-burst-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    QUEUE_PERSIST_WRITE_COUNT.store(0, Ordering::SeqCst);

    let start = Instant::now();
    while Instant::now().duration_since(start) < Duration::from_millis(160) {
        let s = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
        persist_queue_state_lite(&s);
        std::thread::sleep(Duration::from_millis(2));
    }

    // Give the background worker a chance to flush any pending state.
    std::thread::sleep(Duration::from_millis(QUEUE_PERSIST_DEBOUNCE_MS + 50));

    let writes = QUEUE_PERSIST_WRITE_COUNT.load(Ordering::SeqCst);
    let expected_max = 1 + (160 / QUEUE_PERSIST_DEBOUNCE_MS.max(1)) + 3;
    assert!(
        writes <= expected_max as u64,
        "expected debounced persistence to bound writes (writes={writes}, expected_max={expected_max})"
    );

    let _ = fs::remove_file(tmp);
}

#[test]
fn load_persisted_queue_state_accepts_lite_schema() {
    let _guard = PERSIST_TEST_MUTEX.lock().expect("PERSIST_TEST_MUTEX poisoned");

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-load-lite-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let lite = make_state_lite(vec![make_job("job-1", JobStatus::Paused)]);
    fs::write(&tmp, serde_json::to_vec(&lite).expect("serialize lite snapshot"))
        .expect("write persisted lite state");

    let loaded = load_persisted_queue_state().expect("expected to load persisted lite state");
    assert_eq!(loaded.jobs.len(), 1);
    assert!(
        loaded.jobs[0].logs.is_empty(),
        "lite persistence must load into full QueueState with empty logs"
    );

    let _ = fs::remove_file(tmp);
}
