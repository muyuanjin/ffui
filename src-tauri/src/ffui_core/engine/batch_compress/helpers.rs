use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use super::super::ffmpeg_args::configure_background_command;
use super::super::state::{Inner, notify_queue_listeners as notify_engine_queue_listeners};
use super::super::worker_utils::append_job_log_line;
use crate::ffui_core::domain::{
    BatchCompressConfig, JobSource, JobStatus, JobType, MediaInfo, OutputPolicy,
    PreserveFileTimesPolicy, TranscodeJob,
};
use crate::ffui_core::tools::ExternalToolKind;

pub(crate) fn current_time_millis() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

pub(crate) fn next_job_id(inner: &Inner) -> String {
    inner
        .next_job_id
        .fetch_add(1, Ordering::Relaxed)
        .to_string()
}

pub(crate) fn record_tool_download(inner: &Inner, kind: ExternalToolKind, binary_path: &str) {
    super::super::job_runner::record_tool_download_with_inner(inner, kind, binary_path);
}

pub(crate) fn notify_queue_listeners(inner: &Inner) {
    notify_engine_queue_listeners(inner);
}

pub(crate) const fn size_only_media_info(original_size_mb: f64) -> MediaInfo {
    MediaInfo {
        duration_seconds: None,
        width: None,
        height: None,
        frame_rate: None,
        video_codec: None,
        audio_codec: None,
        size_mb: Some(original_size_mb),
    }
}

pub(crate) struct BatchCompressJobSpec {
    pub job_id: String,
    pub filename: String,
    pub job_type: JobType,
    pub preset_id: String,
    pub original_size_mb: f64,
    pub original_codec: Option<String>,
    pub input_path: String,
    pub output_policy: OutputPolicy,
    pub batch_id: String,
    pub start_time: Option<u64>,
}

pub(crate) fn make_batch_compress_job(spec: BatchCompressJobSpec) -> TranscodeJob {
    let BatchCompressJobSpec {
        job_id,
        filename,
        job_type,
        preset_id,
        original_size_mb,
        original_codec,
        input_path,
        output_policy,
        batch_id,
        start_time,
    } = spec;

    let input_times = super::super::file_times::read_file_times(Path::new(&input_path));
    let created_time_ms = input_times
        .created
        .and_then(super::super::file_times::system_time_to_epoch_ms);
    let modified_time_ms = input_times
        .modified
        .and_then(super::super::file_times::system_time_to_epoch_ms);

    TranscodeJob {
        id: job_id,
        filename,
        job_type,
        source: JobSource::BatchCompress,
        queue_order: None,
        original_size_mb,
        original_codec,
        preset_id,
        status: JobStatus::Queued,
        progress: 0.0,
        start_time,
        end_time: None,
        processing_started_ms: None,
        elapsed_ms: None,
        output_size_mb: None,
        logs: Vec::new(),
        log_head: None,
        skip_reason: None,
        input_path: Some(input_path),
        created_time_ms,
        modified_time_ms,
        output_path: None,
        output_policy: Some(output_policy),
        ffmpeg_command: None,
        runs: Vec::new(),
        media_info: Some(size_only_media_info(original_size_mb)),
        estimated_seconds: None,
        preview_path: None,
        preview_revision: 0,
        log_tail: None,
        failure_reason: None,
        warnings: Vec::new(),
        batch_id: Some(batch_id),
        wait_metadata: None,
    }
}

pub(crate) fn capture_input_times_if_needed(
    path: &Path,
    preserve_times_policy: &PreserveFileTimesPolicy,
) -> Option<super::super::file_times::FileTimesSnapshot> {
    if !preserve_times_policy.any() {
        return None;
    }

    let mut times = super::super::file_times::read_file_times(path);
    if !preserve_times_policy.created() {
        times.created = None;
    }
    if !preserve_times_policy.modified() {
        times.modified = None;
    }
    if !preserve_times_policy.accessed() {
        times.accessed = None;
    }
    Some(times)
}

pub(crate) fn mark_job_failed_from_ffmpeg_output(
    job: &mut TranscodeJob,
    tmp_output: &Path,
    stderr: &[u8],
    context: &str,
) {
    job.status = JobStatus::Failed;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    append_job_log_line(job, format!("{context}{}", String::from_utf8_lossy(stderr)));
    drop(fs::remove_file(tmp_output));
}

pub(crate) fn mark_job_skipped_low_savings(job: &mut TranscodeJob, tmp_output: &Path, ratio: f64) {
    drop(fs::remove_file(tmp_output));
    job.status = JobStatus::Skipped;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.skip_reason = Some(format!("Low savings ({:.1}%)", ratio * 100.0));
}

pub(crate) struct FinalizeTmpOutputSpec<'a> {
    pub ffmpeg_path: &'a str,
    pub args: &'a [String],
    pub tmp_output: &'a Path,
    pub output_path: &'a Path,
    pub original_size_bytes: u64,
    pub config: &'a BatchCompressConfig,
    pub job: &'a mut TranscodeJob,
    pub run_context: String,
}

pub(crate) fn run_ffmpeg_and_finalize_tmp_output(
    spec: FinalizeTmpOutputSpec<'_>,
) -> Result<Option<u64>> {
    let FinalizeTmpOutputSpec {
        ffmpeg_path,
        args,
        tmp_output,
        output_path,
        original_size_bytes,
        config,
        job,
        run_context,
    } = spec;

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let output = cmd.args(args).output().with_context(|| run_context)?;

    if !output.status.success() {
        mark_job_failed_from_ffmpeg_output(job, tmp_output, &output.stderr, "");
        return Ok(None);
    }

    let tmp_meta = fs::metadata(tmp_output)
        .with_context(|| format!("failed to stat temp output {}", tmp_output.display()))?;
    let new_size_bytes = tmp_meta.len();
    let ratio = new_size_bytes as f64 / original_size_bytes as f64;

    if ratio > config.min_saving_ratio {
        mark_job_skipped_low_savings(job, tmp_output, ratio);
        return Ok(None);
    }

    fs::rename(tmp_output, output_path).with_context(|| {
        format!(
            "failed to rename {} -> {}",
            tmp_output.display(),
            output_path.display()
        )
    })?;

    Ok(Some(new_size_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }
}
