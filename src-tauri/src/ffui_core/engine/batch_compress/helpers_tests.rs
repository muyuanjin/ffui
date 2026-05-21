use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;

use super::helpers::{
    BatchCompressJobSpec, MediaCommandStopReason, SavingConditionConfig, make_batch_compress_job,
    run_killable_command_capture, saving_condition_allows_output, wait_for_killable_command,
};
use super::replace_original::finalize_replace_original_output;
use crate::ffui_core::domain::{JobSource, JobStatus, JobType, OutputPolicy, SavingConditionType};
use crate::ffui_core::engine::state::Inner;
use crate::ffui_core::settings::AppSettings;
use crate::sync_ext::MutexExt;

#[test]
fn make_batch_compress_job_populates_core_fields() {
    let output_policy = OutputPolicy::default();
    let job = make_batch_compress_job(BatchCompressJobSpec {
        job_id: "job-1".to_string(),
        filename: "file.mkv".to_string(),
        job_type: JobType::Video,
        preset_id: "preset-1".to_string(),
        original_size_mb: 12.5,
        original_codec: Some("h264".to_string()),
        input_path: "in.mp4".to_string(),
        output_policy: output_policy.clone(),
        batch_id: "batch-1".to_string(),
        saving_condition: crate::ffui_core::domain::BatchCompressSavingCondition {
            saving_condition_type: SavingConditionType::Ratio,
            min_saving_ratio: 0.95,
            min_saving_absolute_mb: 5.0,
            min_image_size_kb: None,
            min_audio_size_kb: None,
            image_target_format: None,
            replace_original: None,
        },
        start_time: Some(123),
    });

    assert_eq!(job.id, "job-1");
    assert_eq!(job.filename, "file.mkv");
    assert!(matches!(job.source, JobSource::BatchCompress));
    assert!(matches!(job.status, JobStatus::Queued));
    assert_eq!(job.preset_id, "preset-1");
    assert_eq!(job.batch_id.as_deref(), Some("batch-1"));
    assert_eq!(job.start_time, Some(123));
    assert_eq!(job.input_path.as_deref(), Some("in.mp4"));
    assert_eq!(job.output_policy, Some(output_policy));
    assert_eq!(
        job.batch_compress_saving_condition
            .as_ref()
            .map(|condition| condition.saving_condition_type),
        Some(SavingConditionType::Ratio)
    );
}

#[test]
fn saving_condition_ratio_accepts_only_at_or_below_threshold() {
    let condition = SavingConditionConfig {
        saving_condition_type: SavingConditionType::Ratio,
        min_saving_ratio: 0.8,
        min_saving_absolute_mb: 5.0,
    };
    assert!(saving_condition_allows_output(condition, 100, 80));
    assert!(!saving_condition_allows_output(condition, 100, 81));
}

#[test]
fn saving_condition_absolute_size_accepts_only_required_saved_mb() {
    let condition = SavingConditionConfig {
        saving_condition_type: SavingConditionType::AbsoluteSize,
        min_saving_ratio: 0.95,
        min_saving_absolute_mb: 5.0,
    };
    assert!(saving_condition_allows_output(
        condition,
        20 * 1024 * 1024,
        15 * 1024 * 1024
    ));
    assert!(!saving_condition_allows_output(
        condition,
        20 * 1024 * 1024,
        16 * 1024 * 1024
    ));
}

#[test]
fn saving_condition_absolute_size_rejects_larger_outputs_when_threshold_is_zero() {
    let condition = SavingConditionConfig {
        saving_condition_type: SavingConditionType::AbsoluteSize,
        min_saving_ratio: 0.95,
        min_saving_absolute_mb: 0.0,
    };

    assert!(!saving_condition_allows_output(
        condition,
        20 * 1024 * 1024,
        21 * 1024 * 1024
    ));
    assert!(!saving_condition_allows_output(
        condition,
        20 * 1024 * 1024,
        20 * 1024 * 1024
    ));
    assert!(saving_condition_allows_output(
        condition,
        20 * 1024 * 1024,
        20 * 1024 * 1024 - 1
    ));
}

#[test]
fn killable_command_reports_completed_when_cancel_flag_arrives_after_child_exit() {
    let inner = Inner::new(
        vec![crate::test_support::make_ffmpeg_preset_for_tests(
            "preset-1",
        )],
        AppSettings::default(),
    );
    let job_id = "job-killable-late-cancel";

    let (program, args): (&str, Vec<String>) = if cfg!(windows) {
        ("cmd.exe", vec!["/C".to_string(), "exit 0".to_string()])
    } else {
        ("sh", vec!["-c".to_string(), "exit 0".to_string()])
    };

    let mut child = Command::new(program)
        .args(args)
        .spawn()
        .expect("immediate success command should start");

    loop {
        if child
            .try_wait()
            .expect("immediate success command should be pollable")
            .is_some()
        {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }

    {
        let mut state = inner.state.lock_unpoisoned();
        state.cancelled_jobs.insert(job_id.to_string());
    }

    let (status, stop_reason) = wait_for_killable_command(&inner, job_id, &mut child)
        .expect("completed command should report status");

    assert!(status.success());
    assert_eq!(stop_reason, None);
}

#[test]
fn killable_command_returns_cancel_stop_reason_when_media_job_is_cancelled() {
    let inner = Inner::new(
        vec![crate::test_support::make_ffmpeg_preset_for_tests(
            "preset-1",
        )],
        AppSettings::default(),
    );
    let job_id = "job-killable-cancel";
    {
        let mut state = inner.state.lock_unpoisoned();
        state.cancelled_jobs.insert(job_id.to_string());
    }

    let (program, args): (&str, Vec<String>) = if cfg!(windows) {
        (
            "cmd.exe",
            vec!["/C".to_string(), "ping -n 6 127.0.0.1 >nul".to_string()],
        )
    } else {
        ("sh", vec!["-c".to_string(), "sleep 5".to_string()])
    };

    let output = run_killable_command_capture(
        &inner,
        job_id,
        program,
        &args,
        "failed to start long-running cancellation test command".to_string(),
    )
    .expect("killable command should return after cancellation");

    assert_eq!(
        output.stop_reason,
        Some(MediaCommandStopReason::CancelRequested)
    );
    assert!(
        !output.status.success(),
        "cancelled command should not report a successful exit"
    );
}

#[test]
fn killable_command_returns_wait_stop_reason_when_media_job_waits() {
    let inner = Inner::new(
        vec![crate::test_support::make_ffmpeg_preset_for_tests(
            "preset-1",
        )],
        AppSettings::default(),
    );
    let job_id = "job-killable-wait";
    {
        let mut state = inner.state.lock_unpoisoned();
        state.wait_requests.insert(job_id.to_string());
    }

    let (program, args): (&str, Vec<String>) = if cfg!(windows) {
        (
            "cmd.exe",
            vec!["/C".to_string(), "ping -n 6 127.0.0.1 >nul".to_string()],
        )
    } else {
        ("sh", vec!["-c".to_string(), "sleep 5".to_string()])
    };

    let output = run_killable_command_capture(
        &inner,
        job_id,
        program,
        &args,
        "failed to start long-running wait test command".to_string(),
    )
    .expect("killable command should return after wait request");

    assert_eq!(
        output.stop_reason,
        Some(MediaCommandStopReason::WaitRequested)
    );
    assert!(
        !output.status.success(),
        "wait-stopped command should not report a successful exit"
    );
}

#[test]
fn finalize_replace_original_output_does_not_delete_source_when_final_sibling_exists() {
    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("song.mp3");
    let output = dir.path().join("song.compressed.m4a");
    let sibling = dir.path().join("song.m4a");
    fs::write(&input, b"source").expect("write source");
    fs::write(&output, b"compressed").expect("write staged output");
    fs::write(&sibling, b"existing sibling").expect("write sibling");

    let mut job = crate::test_support::make_transcode_job_for_tests(
        "replace-collision",
        JobStatus::Processing,
        50.0,
        None,
    );

    let final_path = finalize_replace_original_output(&mut job, &input, &output, "audio");

    assert_eq!(final_path, output);
    assert_eq!(fs::read(&input).expect("source should remain"), b"source");
    assert_eq!(
        fs::read(&sibling).expect("sibling should remain"),
        b"existing sibling"
    );
    assert_eq!(
        fs::read(&output).expect("staged output should remain"),
        b"compressed"
    );
    assert!(
        job.logs
            .iter()
            .any(|line| line.text.contains("final path") && line.text.contains("already exists")),
        "job log should explain the collision fallback"
    );
}

#[test]
fn finalize_replace_original_output_replaces_source_when_final_path_is_input() {
    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("input.mp4");
    let output = dir.path().join("input.compressed.mp4");
    fs::write(&input, b"source").expect("write source");
    fs::write(&output, b"compressed").expect("write staged output");

    let mut job = crate::test_support::make_transcode_job_for_tests(
        "replace-same-extension",
        JobStatus::Processing,
        50.0,
        None,
    );

    let final_path = finalize_replace_original_output(&mut job, &input, &output, "video");

    assert_eq!(final_path, input);
    assert_eq!(
        fs::read(&input).expect("source path should contain compressed output"),
        b"compressed"
    );
    assert!(
        !output.exists(),
        "staged output should be moved into the original path"
    );
    assert!(
        job.logs.iter().any(|line| {
            line.text.contains("moved source video") && line.text.contains("to recycle bin")
        }),
        "job log should record moving the source video"
    );
    assert!(
        job.logs.iter().any(|line| {
            let input_path_text = input.to_string_lossy();
            line.text.contains("renamed compressed output")
                && line.text.contains(input_path_text.as_ref())
        }),
        "job log should record renaming the compressed output"
    );
}

#[test]
fn finalize_replace_original_output_restores_source_when_same_path_output_rename_fails() {
    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("input.mp4");
    let output = dir.path().join("input.compressed.mp4");
    fs::write(&input, b"source").expect("write source");

    let mut job = crate::test_support::make_transcode_job_for_tests(
        "replace-same-extension-fail",
        JobStatus::Processing,
        50.0,
        None,
    );

    let final_path = finalize_replace_original_output(&mut job, &input, &output, "video");

    assert_eq!(final_path, output);
    assert_eq!(
        fs::read(&input).expect("source should be restored"),
        b"source"
    );
    assert_eq!(job.status, JobStatus::Failed);
    assert!(
        job.failure_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("failed to rename output")
                && reason.contains("source backup was restored")),
        "failure reason should describe failed output rename and source restore"
    );
    assert!(
        !dir.path()
            .read_dir()
            .expect("read tempdir")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains(".ffui-replace-backup.")),
        "successful restore should not leave a backup file"
    );
}

#[test]
fn finalize_replace_original_output_keeps_source_when_sibling_output_rename_fails() {
    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("song.mp3");
    let output = dir.path().join("song.compressed.m4a");
    fs::write(&input, b"source").expect("write source");

    let mut job = crate::test_support::make_transcode_job_for_tests(
        "replace-sibling-rename-fail",
        JobStatus::Processing,
        50.0,
        None,
    );

    let final_path = finalize_replace_original_output(&mut job, &input, &output, "audio");

    assert_eq!(final_path, output);
    assert_eq!(fs::read(&input).expect("source should remain"), b"source");
    assert_eq!(job.status, JobStatus::Failed);
    assert!(
        job.failure_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("failed to rename output")
                && reason.contains("before moving source audio")),
        "failure reason should explain source was not moved before failed output rename"
    );
}
