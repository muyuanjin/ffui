use std::sync::atomic::Ordering;
use std::time::Duration;

use super::*;
use crate::ffui_core::domain::{TranscodeJob, TranscodeJobLite};
use crate::ffui_core::settings::types::QueuePersistenceMode;
use crate::sync_ext::MutexExt;

fn make_job(id: &str, status: JobStatus) -> TranscodeJob {
    let mut job = crate::test_support::make_transcode_job_for_tests(id, status, 0.0, None);
    job.filename = "C:/videos/test.mp4".to_string();
    job
}

#[test]
fn queue_state_lite_persists_first_real_command_for_restart() {
    let _guard = lock_persist_test_mutex_for_tests();
    reset_queue_persist_state_for_tests();

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-first-run-command-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let mut job = make_job("job-1", JobStatus::Paused);
    job.ffmpeg_command = Some("ffmpeg -i INPUT OUTPUT".to_string());
    job.runs.push(crate::ffui_core::domain::JobRun {
        command: "C:/Tools/ffmpeg.exe -i in.mp4 out.seg0.tmp.mkv".to_string(),
        logs: vec!["command: C:/Tools/ffmpeg.exe -i in.mp4 out.seg0.tmp.mkv".to_string()],
        started_at_ms: Some(123),
    });

    let lite = make_state_lite(vec![job]);
    persist_queue_state_lite(&lite);

    let restored = load_persisted_queue_state().expect("load persisted queue state");
    let restored_job = restored
        .jobs
        .into_iter()
        .find(|j| j.id == "job-1")
        .expect("job restored");

    assert!(
        !restored_job.runs.is_empty(),
        "expected restored job to keep Run 1 command even in lite mode"
    );
    assert_eq!(
        restored_job.runs[0].command,
        "C:/Tools/ffmpeg.exe -i in.mp4 out.seg0.tmp.mkv"
    );

    let _ = fs::remove_file(tmp);
}

fn make_state_lite(jobs: Vec<TranscodeJob>) -> QueueStateLite {
    QueueStateLite {
        snapshot_revision: 0,
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
    let _guard = lock_persist_test_mutex_for_tests();
    reset_queue_persist_state_for_tests();

    let tmp =
        std::env::temp_dir().join(format!("ffui-test-queue-state-{}.json", std::process::id()));
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
    let _guard = lock_persist_test_mutex_for_tests();
    reset_queue_persist_state_for_tests();

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
        writes <= expected_max,
        "expected debounced persistence to bound writes (writes={writes}, expected_max={expected_max})"
    );

    let _ = fs::remove_file(tmp);
}

#[test]
fn load_persisted_queue_state_accepts_lite_schema() {
    let _guard = lock_persist_test_mutex_for_tests();

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-load-lite-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let lite = make_state_lite(vec![make_job("job-1", JobStatus::Paused)]);
    fs::write(
        &tmp,
        serde_json::to_vec(&lite).expect("serialize lite snapshot"),
    )
    .expect("write persisted lite state");

    let loaded = load_persisted_queue_state().expect("expected to load persisted lite state");
    assert_eq!(loaded.jobs.len(), 1);
    assert!(
        loaded.jobs[0].logs.is_empty(),
        "lite persistence must load into full QueueState with empty logs"
    );

    let _ = fs::remove_file(tmp);
}

#[test]
fn load_persisted_queue_state_migrates_legacy_waiting_status_to_queued() {
    let _guard = lock_persist_test_mutex_for_tests();

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-load-legacy-waiting-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let legacy = br#"{"snapshotRevision":0,"jobs":[{"id":"job-1","filename":"C:/videos/legacy.mp4","type":"video","source":"manual","originalSizeMB":1.0,"presetId":"preset-1","status":"waiting","progress":0}]}"#;
    fs::write(&tmp, legacy).expect("write persisted legacy lite state");

    let loaded = load_persisted_queue_state().expect("expected to load persisted legacy state");
    assert_eq!(loaded.jobs.len(), 1);
    assert_eq!(loaded.jobs[0].status, JobStatus::Queued);

    let rewritten = fs::read_to_string(&tmp).expect("read migrated state");
    assert!(
        rewritten.contains(r#""status":"queued""#),
        "expected migrated snapshot to write queued status"
    );
    assert!(
        !rewritten.contains(r#""status":"waiting""#),
        "expected migrated snapshot to remove waiting status"
    );

    let _ = fs::remove_file(tmp);
}

#[test]
fn queue_state_json_contains_slim_logs_only() {
    let _guard = lock_persist_test_mutex_for_tests();
    reset_queue_persist_state_for_tests();

    let tmp = std::env::temp_dir().join(format!(
        "ffui-test-queue-state-slim-{}.json",
        std::process::id()
    ));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let mut job = make_job("job-1", JobStatus::Processing);
    job.logs = (0..500)
        .map(|idx| {
            let mut line = format!("line-{idx:04} ");
            // Make each line long enough that MAX_LOG_TAIL_BYTES truncation
            // drops the middle marker out of the persisted tail.
            line.push_str(&"x".repeat(256));
            if idx == 50 {
                line.push_str(" MIDDLE_MARKER ");
            }
            line
        })
        .collect();
    super::super::worker_utils::recompute_log_tail(&mut job);

    let lite = make_state_lite(vec![job]);
    persist_queue_state_lite(&lite);

    let raw = fs::read_to_string(&tmp).expect("read persisted queue state");
    assert!(
        !raw.contains("\"logs\""),
        "queue-state.json must not embed the full per-line logs vector"
    );
    assert!(
        !raw.contains("MIDDLE_MARKER"),
        "queue-state.json tail should be bounded and must not include the middle marker"
    );
    assert!(
        raw.contains("line-0000"),
        "queue-state.json should include head lines for context"
    );
    assert!(
        raw.contains("line-0499"),
        "queue-state.json should include the tail for recent context"
    );

    let _ = fs::remove_file(tmp);
}

#[test]
fn does_not_write_terminal_logs_without_terminal_transition() {
    let _guard = lock_persist_test_mutex_for_tests();

    let tmp = tempfile::tempdir().expect("temp logs root");
    let dir = tmp.path().join("queue-logs");
    let _dir_guard = override_queue_logs_dir_for_tests(dir.clone());

    TERMINAL_LOG_WRITE_COUNT.store(0, Ordering::SeqCst);

    let mut full_job = make_job("job-1", JobStatus::Processing);
    full_job.logs = vec!["log-line-1".into(), "log-line-2".into()];

    let prev = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
    let current = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);

    for _ in 0..10 {
        persist_terminal_logs_if_needed(
            QueuePersistenceMode::CrashRecoveryFull,
            None,
            Some(&prev),
            &current,
            |_| Some(full_job.clone()),
        );
    }

    assert_eq!(
        TERMINAL_LOG_WRITE_COUNT.load(Ordering::SeqCst),
        0,
        "expected no per-job terminal log writes without a terminal transition"
    );
    assert!(
        !dir.exists(),
        "terminal logs directory should not be created without writes"
    );
}

#[test]
fn writes_terminal_log_exactly_once_on_terminal_transition() {
    let _guard = lock_persist_test_mutex_for_tests();

    let tmp = tempfile::tempdir().expect("temp logs root");
    let dir = tmp.path().join("queue-logs");
    let _dir_guard = override_queue_logs_dir_for_tests(dir.clone());

    TERMINAL_LOG_WRITE_COUNT.store(0, Ordering::SeqCst);

    let mut full_job = make_job("job-1", JobStatus::Completed);
    full_job.logs = vec!["full-1".into(), "full-2".into(), "full-3".into()];

    let prev = make_state_lite(vec![make_job("job-1", JobStatus::Processing)]);
    let current = make_state_lite(vec![make_job("job-1", JobStatus::Completed)]);

    persist_terminal_logs_if_needed(
        QueuePersistenceMode::CrashRecoveryFull,
        None,
        Some(&prev),
        &current,
        |_| Some(full_job.clone()),
    );

    assert_eq!(
        TERMINAL_LOG_WRITE_COUNT.load(Ordering::SeqCst),
        1,
        "expected a single per-job terminal log write"
    );

    let path = queue_job_log_path("job-1").expect("resolve job log path");
    let data = fs::read_to_string(&path).expect("read per-job log file");
    assert!(data.contains("full-1"));
    assert!(data.contains("full-3"));

    // Second call with terminal -> terminal should not write again.
    persist_terminal_logs_if_needed(
        QueuePersistenceMode::CrashRecoveryFull,
        None,
        Some(&current),
        &current,
        |_| Some(full_job.clone()),
    );
    assert_eq!(
        TERMINAL_LOG_WRITE_COUNT.load(Ordering::SeqCst),
        1,
        "expected no additional writes for terminal -> terminal snapshots"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restore_merges_terminal_logs_into_memory_in_full_mode() {
    let _guard = lock_persist_test_mutex_for_tests();

    let tmp_root = tempfile::tempdir().expect("temp queue state root");
    let tmp = tmp_root.path().join("ffui.queue-state.json");
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let logs_root = tempfile::tempdir().expect("temp logs root");
    let dir = logs_root.path().join("queue-logs");
    let _dir_guard = override_queue_logs_dir_for_tests(dir.clone());

    let mut job = make_job("job-1", JobStatus::Completed);
    job.logs = vec!["head-1".into(), "head-2".into()];
    super::super::worker_utils::recompute_log_tail(&mut job);

    let lite = make_state_lite(vec![job]);
    fs::write(
        &tmp,
        serde_json::to_vec(&lite).expect("serialize lite snapshot"),
    )
    .expect("write persisted lite queue state");

    fs::create_dir_all(&dir).expect("create queue logs dir");
    let terminal_path = queue_job_log_path("job-1").expect("resolve job log path");
    fs::write(&terminal_path, "restored-1\nrestored-2\nrestored-3")
        .expect("write terminal log file");

    let settings = crate::ffui_core::settings::AppSettings {
        queue_persistence_mode: QueuePersistenceMode::CrashRecoveryFull,
        crash_recovery_log_retention: None,
        ..Default::default()
    };

    let inner = super::super::state::Inner::new(Vec::new(), settings);
    super::super::state::restore_jobs_from_persisted_queue(&inner);

    let state = inner.state.lock_unpoisoned();
    let restored = state.jobs.get("job-1").expect("job restored");
    assert_eq!(
        restored.logs,
        vec![
            "restored-1".to_string(),
            "restored-2".to_string(),
            "restored-3".to_string()
        ],
        "expected restored job to load full logs into memory"
    );
    assert!(
        restored.log_head.is_none(),
        "expected restored terminal logs to supersede persisted logHead"
    );
    assert!(
        restored
            .log_tail
            .as_ref()
            .is_some_and(|t| t.contains("restored-3")),
        "expected restored logTail to be recomputed from full logs"
    );

    let _ = fs::remove_file(tmp);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn restore_does_not_emit_startup_hint_for_user_paused_jobs() {
    let _guard = lock_persist_test_mutex_for_tests();

    let inner = restore_from_persisted_lite_snapshot(
        "ffui-test-queue-startup-hint-paused",
        vec![make_job("job-1", JobStatus::Paused)],
    );

    assert!(
        inner.queue_startup_hint.lock_unpoisoned().is_none(),
        "manual paused jobs must not trigger a startup recovery hint"
    );
    assert!(
        inner
            .startup_auto_paused_job_ids
            .lock_unpoisoned()
            .is_empty(),
        "manual paused jobs must not be treated as startup auto-paused"
    );

    let state = inner.state.lock_unpoisoned();
    assert!(
        state.jobs.contains_key("job-1"),
        "expected job to be restored"
    );
}

fn restore_from_persisted_lite_snapshot(
    file_prefix: &str,
    jobs: Vec<TranscodeJob>,
) -> super::super::state::Inner {
    let tmp_root = tempfile::tempdir().expect("temp queue state root");
    let tmp = tmp_root
        .path()
        .join(format!("{file_prefix}-{}.json", std::process::id()));
    let _path_guard = override_queue_state_sidecar_path_for_tests(tmp.clone());

    let lite = make_state_lite(jobs);
    fs::write(
        &tmp,
        serde_json::to_vec(&lite).expect("serialize lite snapshot"),
    )
    .expect("write persisted lite queue state");

    let settings = crate::ffui_core::settings::AppSettings {
        queue_persistence_mode: QueuePersistenceMode::CrashRecoveryLite,
        crash_recovery_log_retention: None,
        ..Default::default()
    };
    let inner = super::super::state::Inner::new(Vec::new(), settings);
    super::super::state::restore_jobs_from_persisted_queue(&inner);
    inner
}

#[test]
fn restore_emits_startup_hint_for_auto_paused_jobs() {
    let _guard = lock_persist_test_mutex_for_tests();

    let inner = restore_from_persisted_lite_snapshot(
        "ffui-test-queue-startup-hint-auto-paused",
        vec![make_job("job-1", JobStatus::Queued)],
    );

    let hint = inner
        .queue_startup_hint
        .lock_unpoisoned()
        .clone()
        .expect("expected hint");
    assert_eq!(hint.auto_paused_job_count, 1);
    assert_eq!(
        hint.kind,
        crate::ffui_core::domain::QueueStartupHintKind::NormalRestart
    );

    let auto_paused = inner.startup_auto_paused_job_ids.lock_unpoisoned();
    assert_eq!(auto_paused.len(), 1);
    assert!(auto_paused.contains("job-1"));
}
