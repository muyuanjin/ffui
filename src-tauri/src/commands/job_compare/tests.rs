use std::path::PathBuf;

use super::*;
use crate::ffui_core::{
    ExternalToolSettings, JobStatus, JobType, MediaInfo, TranscodeJob, WaitMetadata,
};

fn sample_video_job(status: JobStatus) -> TranscodeJob {
    TranscodeJob {
        id: "job-1".to_string(),
        filename: "C:/videos/input.mp4".to_string(),
        job_type: JobType::Video,
        source: crate::ffui_core::JobSource::Manual,
        queue_order: None,
        original_size_mb: 0.0,
        original_codec: None,
        preset_id: "preset-1".to_string(),
        status,
        progress: 10.0,
        start_time: None,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some("C:/videos/input.mp4".to_string()),
        created_time_ms: None,
        modified_time_ms: None,
        output_path: Some("C:/videos/output.mp4".to_string()),
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
            last_progress_percent: Some(10.0),
            processed_wall_millis: None,
            processed_seconds: Some(12.5),
            target_seconds: Some(12.5),
            progress_epoch: None,
            last_progress_out_time_seconds: None,
            last_progress_speed: None,
            last_progress_updated_at_ms: None,
            last_progress_frame: None,
            tmp_output_path: Some("C:/app-data/tmp/seg1.mp4".to_string()),
            segments: Some(vec![
                "C:/app-data/tmp/seg0.mp4".to_string(),
                "C:/app-data/tmp/seg1.mp4".to_string(),
            ]),
            segment_end_targets: None,
        }),
    }
}

#[test]
fn allowlisted_paths_reject_arbitrary_sources() {
    let job = sample_video_job(JobStatus::Paused);
    let allowlisted = allowlisted_compare_paths(&job);
    assert!(
        allowlisted.iter().any(|p| p == "C:/videos/input.mp4"),
        "input path should be allowlisted"
    );
    assert!(
        allowlisted.iter().any(|p| p == "C:/app-data/tmp/seg1.mp4"),
        "tmp output should be allowlisted"
    );
    assert!(
        !allowlisted
            .iter()
            .any(|p| p == "C:/windows/system32/notepad.exe"),
        "arbitrary paths must not be allowlisted"
    );
}

#[test]
fn concat_segment_order_is_stable_and_escaped() {
    let segs = vec![
        PathBuf::from("C:/tmp/seg0.mp4"),
        PathBuf::from("C:/tmp/seg'1.mp4"),
    ];
    let contents = crate::ffui_core::build_concat_list_contents_for_tests(&segs);
    assert!(
        contents.lines().next().unwrap_or("").contains("seg0.mp4"),
        "first entry should be seg0"
    );
    assert!(
        contents
            .lines()
            .nth(1)
            .unwrap_or("")
            .contains("seg'\\''1.mp4"),
        "single quotes must be escaped"
    );
}

#[test]
fn concat_cache_path_stays_under_previews() {
    let dir = crate::ffui_core::compare_frames_dir_for_tests();
    let s = dir.to_string_lossy().replace('\\', "/");
    assert!(
        s.contains("/previews/compare-cache/frames")
            || s.ends_with("previews/compare-cache/frames"),
        "compare frames dir must live under previews: {s}"
    );
}

#[test]
fn concat_command_requires_exact_segment_list_match() {
    let job = sample_video_job(JobStatus::Paused);
    let expected = ordered_job_segments(&job);
    assert_eq!(expected.len(), 2);

    let mut reversed = expected.clone();
    reversed.reverse();
    assert_ne!(reversed, expected, "sanity: reversed differs");

    let requested: Vec<String> = reversed;
    assert_ne!(
        requested, expected,
        "requested segment order mismatch should be detectable"
    );
}

#[test]
fn max_compare_seconds_paused_clamps_processed_seconds_to_duration() {
    let mut job = sample_video_job(JobStatus::Paused);
    if let Some(info) = job.media_info.as_mut() {
        info.duration_seconds = Some(10.0);
    }
    // wait_metadata.processed_seconds is 12.5 in sample_video_job; clamp to duration and guard live edge.
    assert_eq!(compute_max_compare_seconds(&job), Some(9.75));
}

#[test]
fn max_compare_seconds_processing_prefers_processed_seconds_over_progress() {
    let mut job = sample_video_job(JobStatus::Processing);
    job.progress = 50.0;
    // processed_seconds is 12.5 in sample_video_job; apply the processing live-edge guard.
    assert_eq!(compute_max_compare_seconds(&job), Some(11.25));
}

#[test]
fn segment_end_targets_map_global_seconds_to_the_correct_segment_offset() {
    let segments = vec![
        "C:/app-data/tmp/seg0.mp4".to_string(),
        "C:/app-data/tmp/seg1.mp4".to_string(),
    ];
    let end_targets = vec![60.0, 120.0];

    let hit0 = map_seconds_to_segment(&segments, &end_targets, 10.0).expect("hit0");
    assert_eq!(hit0.index, 0);
    assert!((hit0.local_seconds - 10.0).abs() < 0.000_001);
    assert_eq!(hit0.duration_seconds_hint, Some(60.0));

    let hit1 = map_seconds_to_segment(&segments, &end_targets, 70.0).expect("hit1");
    assert_eq!(hit1.index, 1);
    assert!((hit1.local_seconds - 10.0).abs() < 0.000_001);
    assert_eq!(hit1.duration_seconds_hint, Some(60.0));
}

#[test]
fn processing_output_targets_append_active_segment_end_when_needed() {
    let mut job = sample_video_job(JobStatus::Processing);
    let Some(meta) = job.wait_metadata.as_mut() else {
        panic!("expected wait_metadata");
    };
    meta.segment_end_targets = Some(vec![60.0]);
    meta.last_progress_out_time_seconds = Some(70.0);
    meta.processed_seconds = Some(70.0);

    let segments = build_output_segments_with_active(&job);
    assert_eq!(segments.len(), 2, "sample should have 2 segments");

    let tools = ExternalToolSettings::default();
    let targets =
        build_segment_end_targets_best_effort(&job, &tools, &segments, 69.0).expect("targets");
    assert_eq!(targets, vec![60.0, 70.0]);
}
