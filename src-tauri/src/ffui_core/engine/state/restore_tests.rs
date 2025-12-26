use super::restore::restore_jobs_from_snapshot;
use crate::ffui_core::domain::{JobSource, JobStatus, JobType, QueueState, TranscodeJob};
use crate::ffui_core::engine::TranscodingEngine;
use crate::ffui_core::shutdown_marker::{ShutdownMarker, ShutdownMarkerKind};
use crate::sync_ext::MutexExt;

fn make_job(id: &str, status: JobStatus) -> TranscodeJob {
    TranscodeJob {
        id: id.to_string(),
        filename: format!("C:/videos/{id}.mp4"),
        job_type: JobType::Video,
        source: JobSource::Manual,
        queue_order: Some(10),
        original_size_mb: 1.0,
        original_codec: None,
        preset_id: "preset-1".to_string(),
        status,
        progress: 0.5,
        start_time: Some(123),
        end_time: None,
        processing_started_ms: Some(456),
        elapsed_ms: Some(789),
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(format!("C:/videos/{id}.mp4")),
        output_path: Some(format!("C:/videos/{id}.out.mp4")),
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
fn restore_marks_auto_wait_processing_ids_as_startup_auto_paused() {
    let engine = TranscodingEngine::new_for_tests();
    {
        let mut guard = engine.inner.previous_shutdown_marker.lock_unpoisoned();
        *guard = Some(ShutdownMarker {
            kind: ShutdownMarkerKind::CleanAutoWait,
            at_ms: 1,
            auto_wait_processing_job_ids: Some(vec!["job-1".to_string()]),
        });
    }

    restore_jobs_from_snapshot(
        engine.inner.as_ref(),
        QueueState {
            jobs: vec![
                make_job("job-1", JobStatus::Paused),
                make_job("job-2", JobStatus::Queued),
            ],
        },
    );

    {
        let auto_paused = engine.inner.startup_auto_paused_job_ids.lock_unpoisoned();
        assert_eq!(auto_paused.len(), 2);
        assert!(auto_paused.contains("job-1"));
        assert!(auto_paused.contains("job-2"));
    }

    let resumed = engine.resume_startup_auto_paused_jobs();
    assert_eq!(resumed, 2);

    let state = engine.inner.state.lock_unpoisoned();
    assert_eq!(state.queue.front().map(String::as_str), Some("job-1"));
    assert_eq!(state.queue.back().map(String::as_str), Some("job-2"));
    let status = state.jobs.get("job-1").expect("job should exist").status;
    assert_eq!(status, JobStatus::Queued);
}
