use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

fn make_manual_job(id: &str, status: JobStatus) -> TranscodeJob {
    TranscodeJob {
        id: id.to_string(),
        filename: format!("C:/videos/{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: None,
        original_size_mb: 10.0,
        original_codec: Some("h264".to_string()),
        preset_id: "preset-1".to_string(),
        status,
        progress: 0.0,
        start_time: Some(current_time_millis()),
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(format!("C:/videos/{id}.mp4")),
        output_path: Some(format!("C:/videos/{id}.compressed.mp4")),
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

#[test]
fn bulk_cancel_notifies_once_and_updates_state() {
    let engine = make_engine_with_preset();

    let queued_id = "job-bulk-cancel-queued".to_string();
    let paused_id = "job-bulk-cancel-paused".to_string();
    let processing_id = "job-bulk-cancel-processing".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            queued_id.clone(),
            make_manual_job(&queued_id, JobStatus::Queued),
        );
        state.queue.push_back(queued_id.clone());
        state.jobs.insert(
            paused_id.clone(),
            make_manual_job(&paused_id, JobStatus::Paused),
        );
        state.queue.push_back(paused_id.clone());
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.cancel_jobs_bulk(vec![
            queued_id.clone(),
            paused_id.clone(),
            processing_id.clone()
        ]),
        "cancel_jobs_bulk must succeed for queued/paused/processing jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(after, before + 1, "bulk cancel must notify exactly once");

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.cancelled_jobs.contains(&processing_id),
        "processing job should be marked for cooperative cancel",
    );
    let queued = state.jobs.get(&queued_id).expect("queued job exists");
    assert_eq!(
        queued.status,
        JobStatus::Cancelled,
        "queued job should be cancelled"
    );
    let paused = state.jobs.get(&paused_id).expect("paused job exists");
    assert_eq!(
        paused.status,
        JobStatus::Cancelled,
        "paused job should be cancelled"
    );
}

#[test]
fn bulk_resume_notifies_once_and_restores_queue_entries() {
    let engine = make_engine_with_preset();

    let paused_a = "job-bulk-resume-a".to_string();
    let paused_b = "job-bulk-resume-b".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_a.clone(),
            make_manual_job(&paused_a, JobStatus::Paused),
        );
        state.jobs.insert(
            paused_b.clone(),
            make_manual_job(&paused_b, JobStatus::Paused),
        );
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.resume_jobs_bulk(vec![paused_a.clone(), paused_b.clone()]),
        "resume_jobs_bulk must succeed for paused jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(after, before + 1, "bulk resume must notify exactly once");

    let state = engine.inner.state.lock_unpoisoned();
    let a = state.jobs.get(&paused_a).expect("job exists");
    let b = state.jobs.get(&paused_b).expect("job exists");
    assert_eq!(a.status, JobStatus::Queued);
    assert_eq!(b.status, JobStatus::Queued);
    assert!(
        state.queue.iter().any(|id| id == &paused_a),
        "resumed job should be enqueued",
    );
    assert!(
        state.queue.iter().any(|id| id == &paused_b),
        "resumed job should be enqueued",
    );
}

#[test]
fn bulk_restart_notifies_once_and_resets_non_processing_jobs() {
    let engine = make_engine_with_preset();

    let processing_id = "job-bulk-restart-processing".to_string();
    let failed_id = "job-bulk-restart-failed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));

        let mut failed = make_manual_job(&failed_id, JobStatus::Failed);
        failed.progress = 100.0;
        failed.failure_reason = Some("boom".to_string());
        state.jobs.insert(failed_id.clone(), failed);
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    let before = notify_calls.load(Ordering::SeqCst);
    assert!(
        engine.restart_jobs_bulk(vec![processing_id.clone(), failed_id.clone()]),
        "restart_jobs_bulk must succeed for processing + failed jobs",
    );
    let after = notify_calls.load(Ordering::SeqCst);
    assert_eq!(after, before + 1, "bulk restart must notify exactly once");

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.restart_requests.contains(&processing_id),
        "processing job should be marked for restart",
    );
    assert!(
        state.cancelled_jobs.contains(&processing_id),
        "processing job should be marked for cooperative cancel",
    );

    let failed = state.jobs.get(&failed_id).expect("failed job exists");
    assert_eq!(failed.status, JobStatus::Queued);
    assert_eq!(failed.progress, 0.0);
    assert!(failed.failure_reason.is_none());
}

#[test]
fn bulk_cancel_ignores_terminal_jobs_and_cancels_processing() {
    let engine = make_engine_with_preset();

    let processing_id = "job-bulk-cancel-ignores-terminal-processing".to_string();
    let completed_id = "job-bulk-cancel-ignores-terminal-completed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));

        state.jobs.insert(
            completed_id.clone(),
            make_manual_job(&completed_id, JobStatus::Completed),
        );
    }

    assert!(
        engine.cancel_jobs_bulk(vec![processing_id.clone(), completed_id.clone()]),
        "cancel_jobs_bulk should succeed even if some jobs are already terminal",
    );

    let state = engine.inner.state.lock_unpoisoned();
    assert!(
        state.cancelled_jobs.contains(&processing_id),
        "processing job should be marked for cooperative cancel",
    );
    let completed = state.jobs.get(&completed_id).expect("job exists");
    assert_eq!(completed.status, JobStatus::Completed);
}

#[test]
fn bulk_resume_ignores_non_paused_jobs_and_resumes_paused() {
    let engine = make_engine_with_preset();

    let paused_id = "job-bulk-resume-ignores-processing-paused".to_string();
    let processing_id = "job-bulk-resume-ignores-processing-processing".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.jobs.insert(
            paused_id.clone(),
            make_manual_job(&paused_id, JobStatus::Paused),
        );
        state.jobs.insert(
            processing_id.clone(),
            make_manual_job(&processing_id, JobStatus::Processing),
        );
        state.active_jobs.insert(processing_id.clone());
        state
            .active_inputs
            .insert(format!("C:/videos/{processing_id}.mp4"));
    }

    assert!(
        engine.resume_jobs_bulk(vec![paused_id.clone(), processing_id.clone()]),
        "resume_jobs_bulk should succeed even if some jobs are not paused",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let paused = state.jobs.get(&paused_id).expect("job exists");
    assert_eq!(paused.status, JobStatus::Queued);
    let processing = state.jobs.get(&processing_id).expect("job exists");
    assert_eq!(processing.status, JobStatus::Processing);
}

#[test]
fn bulk_restart_ignores_completed_jobs_and_restarts_failed() {
    let engine = make_engine_with_preset();

    let failed_id = "job-bulk-restart-ignores-completed-failed".to_string();
    let completed_id = "job-bulk-restart-ignores-completed-completed".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut failed = make_manual_job(&failed_id, JobStatus::Failed);
        failed.progress = 100.0;
        failed.failure_reason = Some("boom".to_string());
        state.jobs.insert(failed_id.clone(), failed);

        state.jobs.insert(
            completed_id.clone(),
            make_manual_job(&completed_id, JobStatus::Completed),
        );
    }

    assert!(
        engine.restart_jobs_bulk(vec![failed_id.clone(), completed_id.clone()]),
        "restart_jobs_bulk should succeed even if some jobs are ineligible",
    );

    let state = engine.inner.state.lock_unpoisoned();
    let failed = state.jobs.get(&failed_id).expect("job exists");
    assert_eq!(failed.status, JobStatus::Queued);
    assert_eq!(failed.progress, 0.0);
    assert!(failed.failure_reason.is_none());

    let completed = state.jobs.get(&completed_id).expect("job exists");
    assert_eq!(completed.status, JobStatus::Completed);
}
