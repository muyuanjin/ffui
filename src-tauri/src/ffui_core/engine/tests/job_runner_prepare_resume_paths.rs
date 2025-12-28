use std::env;
use std::fs::{self, File};
use std::io::Write;

use super::*;
use crate::ffui_core::domain::WaitMetadata;

#[test]
fn plan_resume_paths_uses_last_progress_out_time_when_pause_metadata_missing() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_out_time.mp4");
    let output = dir.join("ffui_resume_plan_out_time.output.mp4");
    let job_id = "job-test-resume-out-time";
    let seg0 = build_video_job_segment_tmp_output_path(&input, None, job_id, 0);
    let seg1 = build_video_job_segment_tmp_output_path(&input, None, job_id, 1);

    if let Some(parent) = seg0.parent() {
        let _ = fs::create_dir_all(parent);
    }
    {
        let mut file = File::create(&seg0).expect("create seg0");
        let _ = file.write_all(b"segment0");
    }

    let meta = WaitMetadata {
        last_progress_percent: Some(55.0),
        processed_wall_millis: None,
        processed_seconds: None,
        target_seconds: None,
        progress_epoch: None,
        last_progress_out_time_seconds: Some(12.5),
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: Some(42),
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
        segment_end_targets: None,
    };

    let (resume_target, existing, _existing_end_targets, tmp_output, resume_plan) =
        plan_resume_paths(job_id, &input, &output, None, Some(&meta), None, 2.0);

    assert!(
        (resume_target.unwrap_or(0.0) - 12.5).abs() < f64::EPSILON,
        "resume_target should prefer last_progress_out_time_seconds"
    );
    assert!(
        resume_plan.is_some(),
        "resume_plan should exist when out_time is available"
    );
    assert_eq!(
        existing,
        vec![seg0.clone()],
        "existing_segments should contain seg0"
    );
    assert_eq!(
        tmp_output, seg1,
        "tmp_output should advance to the next segment"
    );

    let _ = fs::remove_file(&seg0);
    let _ = fs::remove_file(&seg1);
}

#[test]
fn plan_resume_paths_uses_next_segment_for_initial_resume() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_first.mp4");
    let output = dir.join("ffui_resume_plan_first.output.mp4");
    let job_id = "job-test-resume-1";
    let seg0 = build_video_job_segment_tmp_output_path(&input, None, job_id, 0);
    let seg1 = build_video_job_segment_tmp_output_path(&input, None, job_id, 1);

    if let Some(parent) = seg0.parent() {
        let _ = fs::create_dir_all(parent);
    }
    {
        let mut file = File::create(&seg0).expect("create base tmp segment");
        let _ = file.write_all(b"segment");
    }

    let meta = WaitMetadata {
        last_progress_percent: None,
        processed_wall_millis: None,
        processed_seconds: Some(12.5),
        target_seconds: Some(12.5),
        progress_epoch: None,
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
        segment_end_targets: Some(vec![12.5]),
    };

    let (resume_target, existing, existing_end_targets, tmp_output, resume_plan) =
        plan_resume_paths(job_id, &input, &output, Some(100.0), Some(&meta), None, 2.0);

    assert!(
        (resume_target.unwrap_or(0.0) - 12.5).abs() < f64::EPSILON,
        "resume_target should use target_seconds"
    );
    let plan = resume_plan.expect("resume_plan should exist for resumed jobs");
    assert!(
        (plan.target_seconds - 12.5).abs() < f64::EPSILON,
        "plan.target_seconds should match resume_target"
    );
    assert!(
        (plan.seek_seconds - 10.5).abs() < f64::EPSILON,
        "plan.seek_seconds should backtrack by 2.0s"
    );
    assert!(
        (plan.trim_start_seconds - 2.0).abs() < f64::EPSILON,
        "plan.trim_start_seconds should trim to join target"
    );
    assert!(
        (plan.trim_at_seconds - 12.5).abs() < f64::EPSILON,
        "plan.trim_at_seconds should match join target"
    );
    assert!(
        plan.seek_seconds <= plan.target_seconds,
        "resume plan must never seek forward past target"
    );
    assert_eq!(
        existing,
        vec![seg0.clone()],
        "existing_segments should contain seg0"
    );
    assert_eq!(
        existing_end_targets,
        vec![12.5],
        "existing_end_targets should align with existing segments"
    );
    assert_eq!(
        tmp_output, seg1,
        "tmp_output should advance to the next segment"
    );

    let _ = fs::remove_file(&seg0);
    let _ = fs::remove_file(&seg1);
}

#[test]
fn plan_resume_paths_appends_new_segment_after_multiple_pauses() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_multi.mp4");
    let output = dir.join("ffui_resume_plan_multi.output.mp4");
    let job_id = "job-test-resume-2";
    let seg0 = build_video_job_segment_tmp_output_path(&input, None, job_id, 0);
    let seg1 = build_video_job_segment_tmp_output_path(&input, None, job_id, 1);
    let seg2 = build_video_job_segment_tmp_output_path(&input, None, job_id, 2);

    if let Some(parent) = seg0.parent() {
        let _ = fs::create_dir_all(parent);
    }
    {
        let mut file = File::create(&seg0).expect("create seg0");
        let _ = file.write_all(b"segment1");
    }
    {
        let mut file = File::create(&seg1).expect("create seg1");
        let _ = file.write_all(b"segment2");
    }

    let meta = WaitMetadata {
        last_progress_percent: Some(50.0),
        processed_wall_millis: None,
        processed_seconds: Some(50.0),
        target_seconds: Some(50.0),
        progress_epoch: None,
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: Some(seg1.to_string_lossy().into_owned()),
        segments: Some(vec![
            seg0.to_string_lossy().into_owned(),
            seg1.to_string_lossy().into_owned(),
        ]),
        segment_end_targets: Some(vec![25.0, 50.0]),
    };

    let (resume_target, existing, existing_end_targets, tmp_output, resume_plan) =
        plan_resume_paths(job_id, &input, &output, Some(100.0), Some(&meta), None, 2.0);

    assert!(
        (resume_target.unwrap_or(0.0) - 50.0).abs() < f64::EPSILON,
        "resume_target should use target_seconds"
    );
    let plan = resume_plan.expect("resume_plan should exist for resumed jobs");
    assert!(
        (plan.seek_seconds - 48.0).abs() < f64::EPSILON,
        "plan.seek_seconds should backtrack by 2.0s"
    );
    assert!(
        (plan.trim_at_seconds - 50.0).abs() < f64::EPSILON,
        "plan.trim_at_seconds should match join target"
    );
    assert!(
        plan.seek_seconds <= plan.target_seconds,
        "resume plan must never seek forward past target"
    );
    assert_eq!(
        existing,
        vec![seg0.clone(), seg1.clone()],
        "existing_segments should include prior segments in order"
    );
    assert_eq!(
        existing_end_targets,
        vec![25.0, 50.0],
        "existing_end_targets should preserve ordering for prior segments"
    );
    assert_eq!(tmp_output, seg2, "tmp_output should advance to seg2");

    let _ = fs::remove_file(&seg0);
    let _ = fs::remove_file(&seg1);
    let _ = fs::remove_file(&seg2);
}

#[test]
fn plan_resume_paths_clamps_seek_to_zero_when_target_is_smaller_than_backtrack() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_clamp.mp4");
    let output = dir.join("ffui_resume_plan_clamp.output.mp4");
    let job_id = "job-test-resume-3";
    let seg0 = build_video_job_segment_tmp_output_path(&input, None, job_id, 0);

    if let Some(parent) = seg0.parent() {
        let _ = fs::create_dir_all(parent);
    }
    {
        let mut file = File::create(&seg0).expect("create seg0");
        let _ = file.write_all(b"segment");
    }

    let meta = WaitMetadata {
        last_progress_percent: None,
        processed_wall_millis: None,
        processed_seconds: Some(1.0),
        target_seconds: Some(1.0),
        progress_epoch: None,
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
        segment_end_targets: Some(vec![1.0]),
    };

    let (_resume_target, _existing, _existing_end_targets, _tmp_output, resume_plan) =
        plan_resume_paths(job_id, &input, &output, Some(100.0), Some(&meta), None, 2.0);

    let plan = resume_plan.expect("resume_plan should exist");
    assert!(
        (plan.seek_seconds - 0.0).abs() < f64::EPSILON,
        "seek_seconds should clamp at 0 when target < backtrack"
    );
    assert!(
        (plan.trim_start_seconds - 1.0).abs() < f64::EPSILON,
        "trim_start_seconds should equal target when seek clamped to 0"
    );
    assert!(
        (plan.trim_at_seconds - 1.0).abs() < f64::EPSILON,
        "plan.trim_at_seconds should match join target"
    );

    let _ = fs::remove_file(&seg0);
}

#[test]
fn plan_resume_paths_clamps_backtrack_seconds_to_max_seconds() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_backtrack_clamp.mp4");
    let output = dir.join("ffui_resume_plan_backtrack_clamp.output.mp4");
    let job_id = "job-test-resume-4";
    let seg0 = build_video_job_segment_tmp_output_path(&input, None, job_id, 0);
    let seg1 = build_video_job_segment_tmp_output_path(&input, None, job_id, 1);

    if let Some(parent) = seg0.parent() {
        let _ = fs::create_dir_all(parent);
    }
    {
        let mut file = File::create(&seg0).expect("create seg0");
        let _ = file.write_all(b"segment");
    }

    let meta = WaitMetadata {
        last_progress_percent: None,
        processed_wall_millis: None,
        processed_seconds: Some(12.5),
        target_seconds: Some(12.5),
        progress_epoch: None,
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
        segment_end_targets: Some(vec![12.5]),
    };

    let (_resume_target, _existing, existing_end_targets, tmp_output, resume_plan) =
        plan_resume_paths(
            job_id,
            &input,
            &output,
            Some(100.0),
            Some(&meta),
            None,
            999.0,
        );

    assert_eq!(existing_end_targets, vec![12.5]);
    assert_eq!(tmp_output, seg1, "tmp_output should advance to seg1");
    let plan = resume_plan.expect("resume_plan should exist");
    assert!(
        (plan.backtrack_seconds - 30.0).abs() < f64::EPSILON,
        "backtrack_seconds should clamp to MAX_BACKTRACK_SECONDS (30.0)"
    );
    assert!(
        (plan.seek_seconds - 0.0).abs() < f64::EPSILON,
        "seek_seconds should clamp to 0 when target < backtrack cap"
    );
    assert!(
        (plan.trim_start_seconds - 12.5).abs() < f64::EPSILON,
        "trim_start_seconds should trim up to the join target"
    );
    assert_eq!(
        plan.strategy,
        ResumeStrategy::OverlapTrim,
        "clamped backtrack should still use overlap trimming when applicable"
    );

    let _ = fs::remove_file(&seg0);
    let _ = fs::remove_file(&seg1);
}

#[test]
fn plan_resume_paths_treats_nan_backtrack_as_zero() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_nan_backtrack.mp4");
    let output = dir.join("ffui_resume_plan_nan_backtrack.output.mp4");
    let job_id = "job-test-resume-5";
    let seg0 = build_video_job_segment_tmp_output_path(&input, None, job_id, 0);
    let seg1 = build_video_job_segment_tmp_output_path(&input, None, job_id, 1);

    if let Some(parent) = seg0.parent() {
        let _ = fs::create_dir_all(parent);
    }
    {
        let mut file = File::create(&seg0).expect("create seg0");
        let _ = file.write_all(b"segment");
    }

    let meta = WaitMetadata {
        last_progress_percent: None,
        processed_wall_millis: None,
        processed_seconds: Some(12.5),
        target_seconds: Some(12.5),
        progress_epoch: None,
        last_progress_out_time_seconds: None,
        last_progress_speed: None,
        last_progress_updated_at_ms: None,
        last_progress_frame: None,
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
        segment_end_targets: Some(vec![12.5]),
    };

    let (_resume_target, _existing, existing_end_targets, tmp_output, resume_plan) =
        plan_resume_paths(
            job_id,
            &input,
            &output,
            Some(100.0),
            Some(&meta),
            None,
            f64::NAN,
        );

    assert_eq!(existing_end_targets, vec![12.5]);
    assert_eq!(tmp_output, seg1, "tmp_output should advance to seg1");
    let plan = resume_plan.expect("resume_plan should exist");
    assert!(
        (plan.backtrack_seconds - 0.0).abs() < f64::EPSILON,
        "backtrack_seconds should treat NaN as 0"
    );
    assert!(
        (plan.seek_seconds - 12.5).abs() < f64::EPSILON,
        "seek_seconds should not backtrack when backtrack is NaN"
    );
    assert!(
        (plan.trim_start_seconds - 0.0).abs() < f64::EPSILON,
        "trim_start_seconds should be 0 when seek equals target"
    );
    assert_eq!(
        plan.strategy,
        ResumeStrategy::LegacySeek,
        "NaN backtrack should fall back to legacy seek strategy"
    );

    let _ = fs::remove_file(&seg0);
    let _ = fs::remove_file(&seg1);
}
