use std::env;
use std::fs::{
    self,
    File,
};
use std::io::Write;

use super::*;
use crate::ffui_core::domain::WaitMetadata;

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
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
    };

    let (resume_target, existing, tmp_output, resume_plan) =
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
        plan.seek_seconds <= plan.target_seconds,
        "resume plan must never seek forward past target"
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
        tmp_output_path: Some(seg1.to_string_lossy().into_owned()),
        segments: Some(vec![
            seg0.to_string_lossy().into_owned(),
            seg1.to_string_lossy().into_owned(),
        ]),
    };

    let (resume_target, existing, tmp_output, resume_plan) =
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
        plan.seek_seconds <= plan.target_seconds,
        "resume plan must never seek forward past target"
    );
    assert_eq!(
        existing,
        vec![seg0.clone(), seg1.clone()],
        "existing_segments should include prior segments in order"
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
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
    };

    let (_resume_target, _existing, _tmp_output, resume_plan) =
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

    let _ = fs::remove_file(&seg0);
}

#[test]
fn plan_resume_paths_clamps_backtrack_seconds_to_ten_seconds() {
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
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
    };

    let (_resume_target, _existing, tmp_output, resume_plan) = plan_resume_paths(
        job_id,
        &input,
        &output,
        Some(100.0),
        Some(&meta),
        None,
        999.0,
    );

    assert_eq!(tmp_output, seg1, "tmp_output should advance to seg1");
    let plan = resume_plan.expect("resume_plan should exist");
    assert!(
        (plan.backtrack_seconds - 10.0).abs() < f64::EPSILON,
        "backtrack_seconds should clamp to 10.0"
    );
    assert!(
        (plan.seek_seconds - 2.5).abs() < f64::EPSILON,
        "seek_seconds should backtrack by 10.0s"
    );
    assert!(
        (plan.trim_start_seconds - 10.0).abs() < f64::EPSILON,
        "trim_start_seconds should trim to the join point"
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
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
    };

    let (_resume_target, _existing, tmp_output, resume_plan) = plan_resume_paths(
        job_id,
        &input,
        &output,
        Some(100.0),
        Some(&meta),
        None,
        f64::NAN,
    );

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
