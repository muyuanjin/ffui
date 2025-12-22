use super::*;
use crate::ffui_core::WaitMetadata;
use crate::ffui_core::engine::worker_utils::current_time_millis;

#[test]
fn update_job_progress_uses_wall_clock_instead_of_media_duration() {
    let settings = AppSettings::default();
    let inner = Inner::new(Vec::new(), settings);
    let job_id = "job-wall-clock".to_string();
    let start_ms = current_time_millis();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/wall-clock.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::Manual,
                queue_order: None,
                original_size_mb: 100.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 50.0,
                start_time: Some(start_ms.saturating_sub(5_000)),
                end_time: None,
                processing_started_ms: Some(start_ms.saturating_sub(1_000)),
                elapsed_ms: Some(3_000),
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: None,
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: Some(MediaInfo {
                    duration_seconds: Some(120.0),
                    width: None,
                    height: None,
                    frame_rate: None,
                    video_codec: None,
                    audio_codec: None,
                    size_mb: None,
                }),
                estimated_seconds: None,
                preview_path: None,
                preview_revision: 0,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: None,
                wait_metadata: Some(WaitMetadata {
                    last_progress_percent: Some(50.0),
                    processed_wall_millis: Some(3_000),
                    processed_seconds: Some(60.0),
                    target_seconds: Some(60.0),
                    tmp_output_path: None,
                    segments: None,
                }),
            },
        );
    }

    update_job_progress(&inner, &job_id, Some(55.0), None, None);

    let now_after = current_time_millis();
    let state = inner.state.lock().expect("engine state poisoned");
    let job = state.jobs.get(&job_id).expect("job present");
    let elapsed_ms = job.elapsed_ms.expect("elapsed_ms present");

    assert!(
        elapsed_ms >= 3_000,
        "elapsed_ms should carry forward wall-clock baseline, got {elapsed_ms}"
    );
    assert!(
        elapsed_ms < 120_000,
        "elapsed_ms should not use media duration; got inflated value {elapsed_ms}"
    );
    let expected_upper = 3_000 + now_after.saturating_sub(start_ms.saturating_sub(1_000)) + 200;
    assert!(
        elapsed_ms <= expected_upper,
        "elapsed_ms should be bounded by wall-clock delta; got {elapsed_ms}, upper bound {expected_upper}"
    );
}
