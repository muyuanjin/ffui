use super::*;
use crate::ffui_core::domain::WaitMetadata;
use std::env;
use std::fs::{self, File};
use std::io::Write;

#[test]
fn plan_resume_paths_uses_next_segment_for_initial_resume() {
    let dir = env::temp_dir();
    let input = dir.join("ffui_resume_plan_first.mp4");
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
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
    };

    let (resume_from, existing, tmp_output) =
        plan_resume_paths(job_id, &input, Some(100.0), Some(&meta), None);

    assert!(
        (resume_from.unwrap_or(0.0) - 12.5).abs() < f64::EPSILON,
        "resume_from should use processed_seconds"
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
        tmp_output_path: Some(seg1.to_string_lossy().into_owned()),
        segments: Some(vec![
            seg0.to_string_lossy().into_owned(),
            seg1.to_string_lossy().into_owned(),
        ]),
    };

    let (resume_from, existing, tmp_output) =
        plan_resume_paths(job_id, &input, Some(100.0), Some(&meta), None);

    assert!(
        (resume_from.unwrap_or(0.0) - 50.0).abs() < f64::EPSILON,
        "resume_from should use processed_seconds"
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
