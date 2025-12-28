use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::ffui_core::{JobStatus, TranscodingEngine};
use crate::sync_ext::{CondvarExt, MutexExt};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitAutoWaitOutcome {
    pub requested_job_count: usize,
    pub completed_job_count: usize,
    pub timed_out_job_count: usize,
    pub timeout_seconds: f64,
}

#[derive(Default)]
pub struct ExitCoordinator {
    allow_exit: AtomicBool,
    prompt_emitted: AtomicBool,
    system_exit_in_progress: AtomicBool,
}

impl ExitCoordinator {
    pub fn is_exit_allowed(&self) -> bool {
        self.allow_exit.load(Ordering::SeqCst)
    }

    pub fn allow_exit(&self) {
        self.allow_exit.store(true, Ordering::SeqCst);
    }

    pub fn consume_exit_allowance(&self) -> bool {
        self.allow_exit.swap(false, Ordering::SeqCst)
    }

    pub fn try_mark_prompt_emitted(&self) -> bool {
        !self.prompt_emitted.swap(true, Ordering::SeqCst)
    }

    pub fn reset_prompt_emitted(&self) {
        self.prompt_emitted.store(false, Ordering::SeqCst);
    }

    pub fn try_mark_system_exit_in_progress(&self) -> bool {
        !self.system_exit_in_progress.swap(true, Ordering::SeqCst)
    }
}

pub fn pause_processing_jobs_for_exit(
    engine: &TranscodingEngine,
    timeout_seconds: f64,
) -> ExitAutoWaitOutcome {
    let timeout_seconds = if timeout_seconds.is_finite() {
        timeout_seconds
    } else {
        crate::ffui_core::DEFAULT_EXIT_AUTO_WAIT_TIMEOUT_SECONDS
    };

    // Must match "bulk pause" semantics: pause queued jobs immediately so no
    // new job can start while we wait for processing jobs to reach a safe
    // cooperative pause point.
    let (requested_job_count, processing_job_ids) =
        engine.wait_all_processing_and_queued_jobs_bulk();

    let deadline = if timeout_seconds > 0.0 {
        Some(Instant::now() + Duration::from_secs_f64(timeout_seconds))
    } else {
        None
    };
    let mut state = engine.inner.state.lock_unpoisoned();
    loop {
        let remaining = processing_job_ids.iter().filter(|job_id| {
            state
                .jobs
                .get(*job_id)
                .is_some_and(|job| job.status == JobStatus::Processing)
        });

        let remaining_count = remaining.count();
        if remaining_count == 0 {
            break;
        }

        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            break;
        }

        let tick = Duration::from_millis(50);
        let wait_for = deadline.map_or(tick, |deadline| {
            tick.min(deadline.saturating_duration_since(Instant::now()))
        });
        let (guard, _) = engine.inner.cv.wait_timeout_unpoisoned(state, wait_for);
        state = guard;
    }

    let still_processing = processing_job_ids
        .iter()
        .filter(|job_id| {
            state
                .jobs
                .get(*job_id)
                .is_some_and(|job| job.status == JobStatus::Processing)
        })
        .count();
    drop(state);

    // Ensure any recent wait_metadata updates are durable before the process exits.
    let _ = engine.force_persist_queue_state_lite_now();

    ExitAutoWaitOutcome {
        requested_job_count,
        completed_job_count: requested_job_count.saturating_sub(still_processing),
        timed_out_job_count: still_processing,
        timeout_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::QueueStateLite;
    use crate::ffui_core::{JobSource, JobType, QueuePersistenceMode, TranscodeJob};
    use crate::sync_ext::MutexExt;
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;

    fn install_queue_state_sidecar_path(prefix: &str) -> std::path::PathBuf {
        let tmp_dir = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let sidecar_path = tmp_dir.join(format!("{prefix}_{stamp}.json"));
        sidecar_path
    }

    fn make_job(id: &str, status: JobStatus) -> TranscodeJob {
        TranscodeJob {
            id: id.to_string(),
            filename: format!("C:/videos/{id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 0.0,
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
            log_head: None,
            skip_reason: None,
            input_path: Some(format!("C:/videos/{id}.mp4")),
            created_time_ms: None,
            modified_time_ms: None,
            output_path: Some(format!("C:/videos/{id}.out.mkv")),
            output_policy: None,
            ffmpeg_command: None,
            runs: Vec::new(),
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: None,
        }
    }

    fn insert_processing_job(engine: &TranscodingEngine, job_id: &str) -> String {
        let job_id = job_id.to_string();
        let mut state = engine.inner.state.lock_unpoisoned();
        state
            .jobs
            .insert(job_id.clone(), make_job(&job_id, JobStatus::Processing));
        job_id
    }

    fn spawn_pause_job_after_delay(engine: TranscodingEngine, job_id: String, delay: Duration) {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let mut state = engine.inner.state.lock_unpoisoned();
            if let Some(job) = state.jobs.get_mut(&job_id) {
                job.status = JobStatus::Paused;
            }
        });
    }

    #[test]
    fn pause_processing_jobs_for_exit_pauses_queued_jobs_before_processing_job_stops() {
        let engine = TranscodingEngine::new_for_tests();

        let processing_id = "job-exit-processing".to_string();
        let queued_id = "job-exit-queued".to_string();
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            state.jobs.insert(
                processing_id.clone(),
                make_job(&processing_id, JobStatus::Processing),
            );
            state
                .jobs
                .insert(queued_id.clone(), make_job(&queued_id, JobStatus::Queued));
            state.queue.push_back(queued_id.clone());
        }

        let worker_engine = engine.clone();
        let worker_processing_id = processing_id.clone();
        let handle =
            std::thread::spawn(move || pause_processing_jobs_for_exit(&worker_engine, 2.0));

        // Give the worker a moment to request the bulk wait.
        std::thread::sleep(Duration::from_millis(30));
        {
            let state = engine.inner.state.lock_unpoisoned();
            let queued = state.jobs.get(&queued_id).expect("queued job exists");
            assert_eq!(
                queued.status,
                JobStatus::Paused,
                "queued job should be paused immediately during exit auto-wait",
            );
            let processing = state
                .jobs
                .get(&processing_id)
                .expect("processing job exists");
            assert_eq!(
                processing.status,
                JobStatus::Processing,
                "processing job should still be processing until the worker cooperates",
            );
        }

        // Simulate the processing job reaching its safe pause point.
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            let processing = state
                .jobs
                .get_mut(&worker_processing_id)
                .expect("processing job exists");
            processing.status = JobStatus::Paused;
        }
        engine.inner.cv.notify_all();

        let outcome = handle.join().expect("pause thread should finish");
        assert_eq!(outcome.requested_job_count, 2);
        assert_eq!(outcome.timed_out_job_count, 0);
    }

    #[test]
    fn pause_processing_jobs_for_exit_emits_single_queue_notification_for_bulk_wait() {
        let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
        let engine = TranscodingEngine::new_for_tests();

        let notify_count = Arc::new(AtomicUsize::new(0));
        let notify_count_for_listener = notify_count.clone();
        engine.register_queue_listener(move |_| {
            notify_count_for_listener.fetch_add(1, Ordering::SeqCst);
        });

        for idx in 0..32 {
            insert_processing_job(&engine, &format!("job-bulk-{idx}"));
        }

        let _ = pause_processing_jobs_for_exit(&engine, 0.01);

        assert_eq!(
            notify_count.load(Ordering::SeqCst),
            1,
            "bulk exit pause should notify queue listeners once, not per job"
        );
    }

    #[test]
    fn pause_processing_jobs_for_exit_times_out_when_jobs_remain_processing() {
        let engine = TranscodingEngine::new_for_tests();

        let job_id = insert_processing_job(&engine, "job-1");

        let outcome = pause_processing_jobs_for_exit(&engine, 0.01);

        assert_eq!(outcome.requested_job_count, 1);
        assert_eq!(outcome.completed_job_count, 0);
        assert_eq!(outcome.timed_out_job_count, 1);

        let has_wait_request = {
            let state = engine.inner.state.lock_unpoisoned();
            state.wait_requests.contains(&job_id)
        };
        assert!(
            has_wait_request,
            "pause_processing_jobs_for_exit should request wait for processing jobs"
        );
    }

    #[test]
    fn pause_processing_jobs_for_exit_reports_completion_when_job_leaves_processing() {
        let engine = TranscodingEngine::new_for_tests();

        let job_id = insert_processing_job(&engine, "job-2");
        spawn_pause_job_after_delay(engine.clone(), job_id, Duration::from_millis(80));

        let outcome = pause_processing_jobs_for_exit(&engine, 1.0);

        assert_eq!(outcome.requested_job_count, 1);
        assert_eq!(outcome.completed_job_count, 1);
        assert_eq!(outcome.timed_out_job_count, 0);
    }

    #[test]
    fn pause_processing_jobs_for_exit_waits_indefinitely_when_timeout_is_non_positive() {
        let engine = TranscodingEngine::new_for_tests();

        let job_id = insert_processing_job(&engine, "job-4");
        spawn_pause_job_after_delay(engine.clone(), job_id, Duration::from_millis(80));

        let outcome = pause_processing_jobs_for_exit(&engine, 0.0);

        assert_eq!(outcome.requested_job_count, 1);
        assert_eq!(outcome.completed_job_count, 1);
        assert_eq!(outcome.timed_out_job_count, 0);
        assert!((outcome.timeout_seconds - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn force_persist_queue_state_lite_now_writes_snapshot_when_crash_recovery_enabled() {
        let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
        let _env_lock = crate::test_support::env_lock();

        let sidecar_path = install_queue_state_sidecar_path("ffui_exit_persist_test");
        let _sidecar_guard =
            crate::ffui_core::override_queue_state_sidecar_path_for_tests(sidecar_path.clone());

        let engine = TranscodingEngine::new_for_tests();
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            state.settings.queue_persistence_mode = QueuePersistenceMode::CrashRecoveryLite;
            state
                .jobs
                .insert("job-3".to_string(), make_job("job-3", JobStatus::Paused));
        }

        assert!(
            engine.force_persist_queue_state_lite_now(),
            "expected force_persist_queue_state_lite_now to return true when crash recovery is enabled"
        );
        assert!(
            sidecar_path.exists(),
            "expected queue snapshot to be written"
        );

        let _ =
            std::fs::read_to_string(&sidecar_path).expect("expected queue snapshot to be readable");
    }

    #[test]
    fn force_persist_queue_state_lite_now_filters_terminal_jobs_when_crash_recovery_disabled() {
        let _persist_guard = crate::ffui_core::lock_persist_test_mutex_for_tests();
        let _env_lock = crate::test_support::env_lock();

        let sidecar_path = install_queue_state_sidecar_path("ffui_exit_persist_test_none");
        let _sidecar_guard =
            crate::ffui_core::override_queue_state_sidecar_path_for_tests(sidecar_path.clone());

        let engine = TranscodingEngine::new_for_tests();
        {
            let mut state = engine.inner.state.lock_unpoisoned();
            state.settings.queue_persistence_mode = QueuePersistenceMode::None;
            state.jobs.insert(
                "job-paused".to_string(),
                make_job("job-paused", JobStatus::Paused),
            );
            state.jobs.insert(
                "job-completed".to_string(),
                make_job("job-completed", JobStatus::Completed),
            );
        }

        assert!(
            engine.force_persist_queue_state_lite_now(),
            "expected force_persist_queue_state_lite_now to return true when crash recovery is disabled"
        );

        let raw =
            std::fs::read_to_string(&sidecar_path).expect("expected queue snapshot to be readable");
        let parsed: QueueStateLite =
            serde_json::from_str(&raw).expect("expected persisted snapshot to be lite schema");
        assert_eq!(
            parsed.jobs.len(),
            1,
            "expected only resumable jobs to be persisted"
        );
        assert_eq!(
            parsed.jobs[0].id, "job-paused",
            "expected persisted resumable job to be the paused one"
        );
    }
}
