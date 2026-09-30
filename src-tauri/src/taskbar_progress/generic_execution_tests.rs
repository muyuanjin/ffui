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
