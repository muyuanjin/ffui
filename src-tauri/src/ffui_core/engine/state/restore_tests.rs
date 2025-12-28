use super::restore::restore_jobs_from_snapshot;
use crate::ffui_core::domain::{JobSource, JobStatus, JobType, QueueState, TranscodeJob};
use crate::ffui_core::engine::TranscodingEngine;
use crate::ffui_core::engine::segment_discovery;
use crate::ffui_core::shutdown_marker::{ShutdownMarker, ShutdownMarkerKind};
use crate::sync_ext::MutexExt;
use std::path::{Path, PathBuf};

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
        created_time_ms: None,
        modified_time_ms: None,
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

struct SegmentProbePaths {
    tmp: tempfile::TempDir,
    input_dir: PathBuf,
    output_dir: PathBuf,
    input_path: PathBuf,
    output_path: PathBuf,
}

fn setup_segment_probe_paths() -> SegmentProbePaths {
    let tmp = tempfile::tempdir().expect("tempdir");
    let input_dir = tmp.path().join("input");
    let output_dir = tmp.path().join("output");
    std::fs::create_dir_all(&input_dir).expect("create input dir");
    std::fs::create_dir_all(&output_dir).expect("create output dir");

    let input_path = input_dir.join("video.mp4");
    let output_path = output_dir.join("video.mp4");
    std::fs::write(&input_path, b"").expect("create input file");

    SegmentProbePaths {
        tmp,
        input_dir,
        output_dir,
        input_path,
        output_path,
    }
}

fn build_segment_probe_jobs(
    input_path: &Path,
    output_path: &Path,
    jobs_count: usize,
    progress: f64,
    start_time: Option<u64>,
) -> Vec<TranscodeJob> {
    let mut jobs: Vec<TranscodeJob> = Vec::with_capacity(jobs_count);
    let input_path_str = input_path.to_string_lossy().into_owned();
    let output_path_str = output_path.to_string_lossy().into_owned();

    for i in 0..jobs_count {
        let id = format!("job-{i}");
        jobs.push(TranscodeJob {
            id,
            filename: input_path_str.clone(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: Some(u64::try_from(i).unwrap_or(u64::MAX)),
            original_size_mb: 1.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status: JobStatus::Paused,
            progress,
            start_time,
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some(input_path_str.clone()),
            created_time_ms: None,
            modified_time_ms: None,
            output_path: Some(output_path_str.clone()),
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
        });
    }

    jobs
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

#[test]
fn crash_recovery_segment_probe_skips_dir_scan_when_no_evidence_exists() {
    let paths = setup_segment_probe_paths();
    assert!(
        paths.output_dir.starts_with(paths.tmp.path()),
        "expected output_dir under temp root"
    );
    assert_eq!(
        paths.input_path.parent(),
        Some(paths.input_dir.as_path()),
        "expected input_path under input_dir"
    );
    let jobs_count: usize = 400;
    segment_discovery::reset_list_segment_candidates_calls_for_tests();

    let engine = TranscodingEngine::new_for_tests();
    let jobs =
        build_segment_probe_jobs(&paths.input_path, &paths.output_path, jobs_count, 0.0, None);

    restore_jobs_from_snapshot(engine.inner.as_ref(), QueueState { jobs });
    assert_eq!(
        segment_discovery::list_segment_candidates_calls_for_tests(),
        0,
        "expected no directory scanning during startup restore"
    );

    let job_ids: Vec<String> = (0..jobs_count).map(|i| format!("job-{i}")).collect();
    assert!(
        engine.resume_jobs_bulk(job_ids),
        "bulk resume should succeed"
    );
    assert_eq!(
        segment_discovery::list_segment_candidates_calls_for_tests(),
        0,
        "expected no directory scanning during bulk resume"
    );
}

#[test]
fn crash_recovery_segment_probe_scans_each_unique_dir_once() {
    let paths = setup_segment_probe_paths();
    assert!(
        paths.output_dir.starts_with(paths.tmp.path()),
        "expected output_dir under temp root"
    );
    assert_eq!(
        paths.input_path.parent(),
        Some(paths.input_dir.as_path()),
        "expected input_path under input_dir"
    );
    let jobs_count: usize = 400;
    for i in 0..jobs_count {
        let id = format!("job-{i}");
        let seg = paths.output_dir.join(format!("video.{id}.seg0.tmp.mp4"));
        std::fs::write(seg, b"").expect("write segment file");
    }

    segment_discovery::reset_list_segment_candidates_calls_for_tests();

    let engine = TranscodingEngine::new_for_tests();
    let jobs = build_segment_probe_jobs(
        &paths.input_path,
        &paths.output_path,
        jobs_count,
        1.0,
        Some(123),
    );

    restore_jobs_from_snapshot(engine.inner.as_ref(), QueueState { jobs });

    assert_eq!(
        segment_discovery::list_segment_candidates_calls_for_tests(),
        0,
        "expected no directory scanning during startup restore"
    );

    let job_ids: Vec<String> = (0..jobs_count).map(|i| format!("job-{i}")).collect();
    assert!(
        engine.resume_jobs_bulk(job_ids),
        "bulk resume should succeed"
    );
    let calls = segment_discovery::list_segment_candidates_calls_for_tests();
    assert_eq!(
        calls, 0,
        "expected no directory scanning during bulk resume"
    );
}
