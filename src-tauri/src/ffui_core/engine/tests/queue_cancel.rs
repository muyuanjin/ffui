use std::{env, fs};

use super::*;
use crate::ffui_core::domain::WaitMetadata;

#[test]
fn cancel_paused_job_transitions_to_cancelled_and_allows_delete() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/cancel-paused.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let dir = env::temp_dir().join("ffui_cancel_paused_test");
    let _ = fs::create_dir_all(&dir);
    let seg0 = dir.join("segment0.tmp.mp4");
    fs::write(&seg0, b"partial").expect("write segment0");

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state.queue.retain(|id| id != &job.id);
        let stored = state.jobs.get_mut(&job.id).expect("job exists");
        stored.status = JobStatus::Paused;
        stored.progress = 33.0;
        stored.wait_metadata = Some(WaitMetadata {
            last_progress_percent: Some(33.0),
            processed_wall_millis: Some(1234),
            processed_seconds: Some(12.3),
            target_seconds: Some(12.3),
            tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
            segments: Some(vec![seg0.to_string_lossy().into_owned()]),
            segment_end_targets: None,
        });
    }

    assert!(
        engine.cancel_job(&job.id),
        "cancel_job must accept Paused jobs"
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        let stored = state.jobs.get(&job.id).expect("job exists after cancel");
        assert_eq!(stored.status, JobStatus::Cancelled);
        assert!(stored.wait_metadata.is_none());
    }

    assert!(
        engine.delete_job(&job.id),
        "cancelled job should be deletable"
    );
    assert!(
        !seg0.exists(),
        "cancelling a paused job should best-effort remove partial segments"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn cancel_processing_job_clears_pending_wait_request() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/cancel-vs-wait.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        // Simulate a worker having claimed the job.
        state.queue.retain(|id| id != &job.id);
        let stored = state.jobs.get_mut(&job.id).expect("job exists");
        stored.status = JobStatus::Processing;
        state.wait_requests.insert(job.id.clone());
    }

    assert!(engine.cancel_job(&job.id));

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(!state.wait_requests.contains(&job.id));
        assert!(state.cancelled_jobs.contains(&job.id));
    }
}
