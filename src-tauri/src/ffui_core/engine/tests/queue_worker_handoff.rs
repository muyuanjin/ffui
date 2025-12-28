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
        created_time_ms: None,
        modified_time_ms: None,
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
fn worker_handoff_coalesces_state_change_before_single_notify() {
    let engine = make_engine_with_preset();

    let job1 = "job-handoff-1".to_string();
    let job2 = "job-handoff-2".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        state
            .jobs
            .insert(job1.clone(), make_manual_job(&job1, JobStatus::Queued));
        state.queue.push_back(job1.clone());
        state
            .jobs
            .insert(job2.clone(), make_manual_job(&job2, JobStatus::Queued));
        state.queue.push_back(job2.clone());
    }

    let notify_calls = TestArc::new(AtomicUsize::new(0));
    let notify_calls_clone = notify_calls.clone();
    engine.register_queue_lite_listener(move |_| {
        notify_calls_clone.fetch_add(1, Ordering::SeqCst);
    });

    // Start job1 (normal path): pick + notify "processing".
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let picked = next_job_for_worker_locked(&mut state).expect("job1 should be picked");
        assert_eq!(picked, job1);
    }
    notify_queue_listeners(&engine.inner);
    assert_eq!(notify_calls.load(Ordering::SeqCst), 1);

    // Finish job1 and immediately start job2 under the same lock, then notify once.
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let j1 = state.jobs.get_mut(&job1).expect("job1 exists");
        j1.status = JobStatus::Completed;
        j1.progress = 100.0;
        j1.end_time = Some(current_time_millis());

        let picked = finish_job_and_try_start_next_locked(&mut state, &job1);
        assert_eq!(
            picked.as_deref(),
            Some(job2.as_str()),
            "job2 should be picked during handoff",
        );
    }
    notify_queue_listeners(&engine.inner);
    assert_eq!(
        notify_calls.load(Ordering::SeqCst),
        2,
        "handoff should be broadcast in a single notify",
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            state.active_jobs.contains(&job2),
            "job2 must already be processing when the handoff notify fires",
        );
        assert!(!state.active_jobs.contains(&job1));
        let j1 = state.jobs.get(&job1).expect("job1 exists");
        assert_eq!(j1.status, JobStatus::Completed);
        let j2 = state.jobs.get(&job2).expect("job2 exists");
        assert_eq!(j2.status, JobStatus::Processing);
    }

    // Finish job2 (no next job): cleanup + notify once.
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let j2 = state.jobs.get_mut(&job2).expect("job2 exists");
        j2.status = JobStatus::Completed;
        j2.progress = 100.0;
        j2.end_time = Some(current_time_millis());
        let picked = finish_job_and_try_start_next_locked(&mut state, &job2);
        assert!(picked.is_none(), "no further jobs should be picked");
    }
    notify_queue_listeners(&engine.inner);
    assert_eq!(notify_calls.load(Ordering::SeqCst), 3);
}
