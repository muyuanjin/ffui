use super::*;
use crate::ffui_core::{
    FfmpegInvocation, FfmpegOutput, JobExecution, TranscodeJobLite, TranscodeJobUiLite,
};

#[test]
fn full_lite_and_ui_lite_preserve_indeterminate_execution_capability() {
    for output in [
        FfmpegOutput::Transparent,
        FfmpegOutput::ManagedFile {
            path: "out.wav".into(),
            argument_index: 0,
        },
    ] {
        let mut job = crate::test_support::make_transcode_job_for_tests(
            "generic",
            JobStatus::Processing,
            42.0,
            None,
        );
        job.execution = Some(JobExecution::Ffmpeg {
            invocation: FfmpegInvocation {
                args: vec!["out.wav".into()],
                working_directory: None,
                progress: None,
                output,
            },
        });
        let lite = TranscodeJobLite::from(&job);
        let ui_lite = TranscodeJobUiLite::from(&job);
        let expected = TaskbarProgressValue::Indeterminate;
        assert_eq!(
            compute_taskbar_progress_value_generic(
                &[job.clone()],
                TaskbarProgressMode::BySize,
                TaskbarProgressScope::AllJobs
            ),
            expected
        );
        assert_eq!(
            compute_taskbar_progress_value_generic(
                &[lite],
                TaskbarProgressMode::BySize,
                TaskbarProgressScope::AllJobs
            ),
            expected
        );
        assert_eq!(
            compute_taskbar_progress_value_generic(
                &[ui_lite],
                TaskbarProgressMode::BySize,
                TaskbarProgressScope::AllJobs
            ),
            expected
        );
        job.status = JobStatus::Completed;
        assert_eq!(
            compute_taskbar_progress_value_generic(
                &[job],
                TaskbarProgressMode::BySize,
                TaskbarProgressScope::AllJobs
            ),
            TaskbarProgressValue::Determinate(1.0)
        );
    }
}

#[test]
fn measured_managed_progress_matches_full_lite_ui_and_incremental_taskbar_views() {
    let mut job = crate::test_support::make_transcode_job_for_tests(
        "audio",
        JobStatus::Processing,
        42.0,
        None,
    );
    job.execution = Some(JobExecution::Ffmpeg {
        invocation: FfmpegInvocation {
            args: vec!["out.wav".into()],
            working_directory: None,
            output: FfmpegOutput::ManagedFile {
                path: "out.wav".into(),
                argument_index: 0,
            },
            progress: Some(crate::ffui_core::FfmpegProgress::InputDuration),
        },
    });
    job.wait_metadata = Some(
        serde_json::from_value(serde_json::json!({"lastProgressPercent": 42.0})).expect("metadata"),
    );
    let lite = TranscodeJobLite::from(&job);
    let ui = TranscodeJobUiLite::from(&job);
    let expected = compute_taskbar_progress_value_generic(
        &[job],
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::AllJobs,
    );
    let TaskbarProgressValue::Determinate(value) = expected else {
        panic!("measured progress must be determinate");
    };
    assert!((value - 0.42).abs() < f64::EPSILON);
    assert_eq!(
        compute_taskbar_progress_value_generic(
            &[lite],
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs
        ),
        expected
    );
    assert_eq!(
        compute_taskbar_progress_value_generic(
            std::slice::from_ref(&ui),
            TaskbarProgressMode::BySize,
            TaskbarProgressScope::AllJobs
        ),
        expected
    );
    let mut tracker = crate::ffui_core::TaskbarProgressDeltaTracker::default();
    tracker.reset_from_ui_lite(
        &crate::ffui_core::QueueStateUiLite {
            snapshot_revision: 1,
            latest_delta_revision: 0,
            jobs: vec![ui],
        },
        TaskbarProgressMode::BySize,
        TaskbarProgressScope::AllJobs,
    );
    assert_eq!(tracker.display_progress(), expected);
}
