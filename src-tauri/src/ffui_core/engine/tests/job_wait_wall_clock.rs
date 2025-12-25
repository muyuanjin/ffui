use super::*;
use crate::ffui_core::engine::worker_utils::current_time_millis;

#[test]
fn mark_job_waiting_does_not_double_count_wall_clock_on_first_pause() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/wait-wall-clock.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let job_id = job.id;
    let start_ms = current_time_millis();

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let stored = state
            .jobs
            .get_mut(&job_id)
            .expect("job must exist after enqueue");
        stored.status = JobStatus::Processing;
        stored.progress = 50.0;
        stored.start_time = Some(start_ms.saturating_sub(5_000));
        stored.processing_started_ms = Some(start_ms);
        // Simulate update_job_progress having already maintained a wall-clock
        // elapsed_ms baseline during processing.
        stored.elapsed_ms = Some(3_000);
    }

    let tmp = PathBuf::from("C:/videos/wait-wall-clock.compressed.tmp.mp4");
    let out = PathBuf::from("C:/videos/wait-wall-clock.compressed.mp4");

    mark_job_waiting(&engine.inner, &job_id, &tmp, &out, Some(100.0), None)
        .expect("mark_job_waiting must succeed");

    let now_after = current_time_millis();

    let state = engine.inner.state.lock_unpoisoned();
    let stored = state
        .jobs
        .get(&job_id)
        .expect("job must remain present after wait");
    let elapsed_ms = stored.elapsed_ms.expect("elapsed_ms should be set");

    let baseline = stored
        .processing_started_ms
        .or(stored.start_time)
        .unwrap_or(start_ms);
    let expected_upper = now_after.saturating_sub(baseline) + 250;

    assert!(
        elapsed_ms <= expected_upper,
        "elapsed_ms should be bounded by wall-clock delta without double-counting; \
         got {elapsed_ms}, upper bound {expected_upper}"
    );
}

#[test]
fn mark_job_waiting_prefers_processed_seconds_override_over_progress_estimate() {
    let engine = make_engine_with_preset();

    let job = engine.enqueue_transcode_job(
        "C:/videos/wait-processed-seconds-override.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        100.0,
        Some("h264".into()),
        "preset-1".into(),
    );

    let job_id = job.id;

    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let stored = state
            .jobs
            .get_mut(&job_id)
            .expect("job must exist after enqueue");
        stored.status = JobStatus::Processing;
        stored.progress = 10.0;
        stored.media_info = Some(MediaInfo {
            duration_seconds: Some(100.0),
            width: None,
            height: None,
            frame_rate: None,
            video_codec: None,
            audio_codec: None,
            size_mb: None,
        });
    }

    let tmp = PathBuf::from("C:/videos/wait-processed-seconds-override.tmp.mp4");
    let out = PathBuf::from("C:/videos/wait-processed-seconds-override.out.mp4");

    mark_job_waiting(&engine.inner, &job_id, &tmp, &out, Some(100.0), Some(42.0))
        .expect("mark_job_waiting must succeed");

    let state = engine.inner.state.lock_unpoisoned();
    let stored = state
        .jobs
        .get(&job_id)
        .expect("job must remain present after wait");
    let meta = stored
        .wait_metadata
        .as_ref()
        .expect("wait_metadata should be set");
    assert!(
        (meta.processed_seconds.unwrap_or(0.0) - 42.0).abs() < 0.0001,
        "processed_seconds must come from override when provided"
    );
}
