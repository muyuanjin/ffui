use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use super::super::ffmpeg_args::configure_background_command;
use super::super::state::{Inner, notify_queue_listeners as notify_engine_queue_listeners};
use super::super::worker_utils::append_job_log_line;
use crate::ffui_core::domain::{
    BatchCompressConfig, JobSource, JobStatus, JobType, MediaInfo, OutputDirectoryPolicy,
    OutputFilenamePolicy, OutputPolicy, PreserveFileTimesPolicy, SavingConditionType, TranscodeJob,
};
use crate::ffui_core::tools::ExternalToolKind;
use crate::sync_ext::MutexExt;

pub(crate) fn current_time_millis() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

pub(crate) fn next_job_id(inner: &Inner) -> String {
    let next_id = inner.next_job_id.fetch_add(1, Ordering::Relaxed);
    format!("job-{next_id}")
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
    pub saving_condition: crate::ffui_core::domain::BatchCompressSavingCondition,
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
        saving_condition,
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
        batch_compress_saving_condition: Some(saving_condition),
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

pub(crate) fn replace_original_output_policy(config: &BatchCompressConfig) -> OutputPolicy {
    if !config.replace_original {
        return config.output_policy.clone();
    }

    OutputPolicy {
        container: config.output_policy.container.clone(),
        directory: OutputDirectoryPolicy::SameAsInput,
        filename: OutputFilenamePolicy::default(),
        preserve_file_times: config.output_policy.preserve_file_times.clone(),
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct SavingConditionConfig {
    pub saving_condition_type: SavingConditionType,
    pub min_saving_ratio: f64,
    pub min_saving_absolute_mb: f64,
}

impl From<&BatchCompressConfig> for SavingConditionConfig {
    fn from(value: &BatchCompressConfig) -> Self {
        Self {
            saving_condition_type: value.saving_condition_type,
            min_saving_ratio: value.min_saving_ratio,
            min_saving_absolute_mb: value.min_saving_absolute_mb,
        }
    }
}

pub(crate) fn saving_condition_allows_output(
    condition: SavingConditionConfig,
    original_size_bytes: u64,
    new_size_bytes: u64,
) -> bool {
    if original_size_bytes == 0 || new_size_bytes == 0 {
        return false;
    }

    match condition.saving_condition_type {
        SavingConditionType::Ratio => {
            let ratio = new_size_bytes as f64 / original_size_bytes as f64;
            ratio <= condition.min_saving_ratio
        }
        SavingConditionType::AbsoluteSize => {
            if new_size_bytes >= original_size_bytes {
                return false;
            }
            let saved_bytes = original_size_bytes - new_size_bytes;
            let saved_mb = saved_bytes as f64 / (1024.0 * 1024.0);
            saved_mb >= condition.min_saving_absolute_mb
        }
    }
}

pub(crate) fn saving_condition_skip_reason(
    condition: SavingConditionConfig,
    original_size_bytes: u64,
    new_size_bytes: u64,
) -> String {
    match condition.saving_condition_type {
        SavingConditionType::Ratio => {
            let ratio = if original_size_bytes == 0 {
                1.0
            } else {
                new_size_bytes as f64 / original_size_bytes as f64
            };
            format!("Low savings ({:.1}%)", ratio * 100.0)
        }
        SavingConditionType::AbsoluteSize => {
            let saved_mb = (original_size_bytes as f64 - new_size_bytes as f64) / (1024.0 * 1024.0);
            format!(
                "Low savings ({saved_mb:.2} MB saved, requires {:.2} MB)",
                condition.min_saving_absolute_mb
            )
        }
    }
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

pub(crate) fn mark_job_cancelled_from_media_worker(job: &mut TranscodeJob, tmp_output: &Path) {
    drop(fs::remove_file(tmp_output));
    job.status = JobStatus::Cancelled;
    job.end_time = Some(current_time_millis());
    job.wait_metadata = None;
    append_job_log_line(job, "Cancelled while processing Batch Compress media child");
}

pub(crate) fn mark_job_skipped_by_saving_condition(
    job: &mut TranscodeJob,
    tmp_output: &Path,
    condition: SavingConditionConfig,
    original_size_bytes: u64,
    new_size_bytes: u64,
) {
    drop(fs::remove_file(tmp_output));
    job.status = JobStatus::Skipped;
    job.progress = 100.0;
    job.end_time = Some(current_time_millis());
    job.skip_reason = Some(saving_condition_skip_reason(
        condition,
        original_size_bytes,
        new_size_bytes,
    ));
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

pub(crate) struct KillableCommandOutput {
    pub status: ExitStatus,
    pub stderr: Vec<u8>,
    pub cancelled: bool,
}

fn is_cancel_requested(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock_unpoisoned();
    state.cancelled_jobs.contains(job_id)
}

fn read_capture_file(file: &mut fs::File) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(0))
        .with_context(|| "failed to rewind command capture file")?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .with_context(|| "failed to read command capture file")?;
    Ok(buf)
}

pub(super) fn wait_for_killable_command(
    inner: &Inner,
    job_id: &str,
    child: &mut Child,
) -> Result<(ExitStatus, bool)> {
    loop {
        if let Some(status) = child
            .try_wait()
            .with_context(|| "failed to poll media command status")?
        {
            return Ok((status, false));
        }

        if is_cancel_requested(inner, job_id) {
            let kill_result = child.kill();
            let status = child
                .wait()
                .with_context(|| "failed to wait for cancelled media command")?;
            let cancelled = kill_result.is_ok() && !status.success();
            return Ok((status, cancelled));
        }

        thread::sleep(Duration::from_millis(100));
    }
}

pub(crate) fn run_killable_command_capture(
    inner: &Inner,
    job_id: &str,
    program: &str,
    args: &[String],
    run_context: String,
) -> Result<KillableCommandOutput> {
    let mut stdout_file =
        tempfile::tempfile().with_context(|| "failed to create stdout capture file")?;
    let mut stderr_file =
        tempfile::tempfile().with_context(|| "failed to create stderr capture file")?;

    let mut cmd = Command::new(program);
    configure_background_command(&mut cmd);
    let mut child = cmd
        .args(args)
        .stdout(Stdio::from(
            stdout_file
                .try_clone()
                .with_context(|| "failed to clone stdout capture file")?,
        ))
        .stderr(Stdio::from(
            stderr_file
                .try_clone()
                .with_context(|| "failed to clone stderr capture file")?,
        ))
        .spawn()
        .with_context(|| run_context.clone())?;

    let (status, cancelled) = wait_for_killable_command(inner, job_id, &mut child)?;

    let _stdout = read_capture_file(&mut stdout_file)?;
    let stderr = read_capture_file(&mut stderr_file)?;

    Ok(KillableCommandOutput {
        status,
        stderr,
        cancelled,
    })
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
    let condition = SavingConditionConfig::from(config);
    if !saving_condition_allows_output(condition, original_size_bytes, new_size_bytes) {
        mark_job_skipped_by_saving_condition(
            job,
            tmp_output,
            condition,
            original_size_bytes,
            new_size_bytes,
        );
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
