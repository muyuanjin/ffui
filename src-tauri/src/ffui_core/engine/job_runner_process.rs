// ============================================================================
// Core job processing
// ============================================================================

use crate::ffui_core::settings::AppSettings;
use crate::ffui_core::domain::FFmpegPreset;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ResumeStrategy {
    LegacySeek,
    OverlapTrim,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct ResumePlan {
    pub(super) target_seconds: f64,
    pub(super) seek_seconds: f64,
    pub(super) trim_start_seconds: f64,
    pub(super) trim_at_seconds: f64,
    pub(super) backtrack_seconds: f64,
    pub(super) strategy: ResumeStrategy,
}

/// Prepared snapshot and configuration for a single transcode job.
///
/// This structure collects all values that need to flow from the initial
/// queue/state inspection phase into the long-running ffmpeg execution phase.
struct PreparedTranscodeJob {
    input_path: PathBuf,
    settings_snapshot: AppSettings,
    preset: FFmpegPreset,
    finalize_preset: FFmpegPreset,
    original_size_bytes: u64,
    preset_id: String,
    output_path: PathBuf,
    resume_target_seconds: Option<f64>,
    resume_plan: Option<ResumePlan>,
    finalize_with_source_audio: bool,
    // Partial output segments accumulated across previous pauses. When this
    // vector is non-empty,本次运行会在成功完成后将这些分段与当前 tmp_output
    // 生成的最新分段一起 concat 为最终输出。
    existing_segments: Vec<PathBuf>,
    // Join target end times (seconds) for each completed segment in
    // `existing_segments`. Length SHOULD equal `existing_segments.len()` when
    // available; used to build concat lists with explicit durations.
    segment_end_targets: Vec<f64>,
    tmp_output: PathBuf,
    total_duration: Option<f64>,
    ffmpeg_path: String,
    ffmpeg_source: String,
}

pub(super) fn process_transcode_job(inner: &Inner, job_id: &str) -> Result<()> {
    // Phase 1: inspect queue state, resolve preset/paths, and persist media
    // metadata plus preview paths back into the job. When the job does not
    // require processing (non-video or missing preset) this returns Ok(None)
    // after updating the job state accordingly.
    let Some(prepared) = prepare_transcode_job(inner, job_id)? else {
        return Ok(());
    };

    // Phase 2: run ffmpeg, stream progress/logs, handle cooperative
    // wait/cancel, and finalize statistics/output files.
    execute_transcode_job(inner, job_id, prepared)
}

include!("job_runner_process_resume_utils.rs");
include!("job_runner_process_execute_replace_original.rs");
include!("job_runner_process_execute.rs");
include!("job_runner_process_execute_finalize.rs");
include!("job_runner_process_execute_resume_support.rs");
include!("job_runner_process_prepare.rs");
include!("job_runner_process_prepare_resume.rs");

#[cfg(test)]
mod resume_support_tests {
    use super::FfmpegStderrPump;

    #[test]
    fn stderr_pump_does_not_drop_lines_emitted_during_join() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let join = std::thread::spawn(move || {
            tx.send("first".to_string()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(30));
            tx.send("last".to_string()).unwrap();
        });

        let mut pump = FfmpegStderrPump {
            rx: Some(rx),
            join: Some(join),
        };

        let mut got = Vec::new();
        pump.drain_exit_bound_lines(|line| got.push(line));

        assert_eq!(got, vec!["first".to_string(), "last".to_string()]);
    }
}
