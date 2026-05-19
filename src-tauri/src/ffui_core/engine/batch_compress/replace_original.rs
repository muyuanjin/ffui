use std::fs;
use std::path::{Path, PathBuf};

use super::super::worker_utils::append_job_log_line;
use super::helpers::current_time_millis;
use crate::ffui_core::domain::{JobStatus, TranscodeJob};

pub(crate) fn replacement_final_path(input_path: &Path, output_path: &Path) -> PathBuf {
    let final_dir = input_path
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("out");
    final_dir.join(format!("{stem}.{ext}"))
}

fn sanitize_backup_suffix(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(
            |ch| match ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                true => ch,
                false => '-',
            },
        )
        .collect();
    match sanitized.is_empty() {
        true => "job".to_string(),
        false => sanitized,
    }
}

fn replace_original_backup_path(input_path: &Path, job_id: &str) -> PathBuf {
    let parent = input_path
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let job_id = sanitize_backup_suffix(job_id);
    let file_name = input_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("input");
    let timestamp = current_time_millis();

    for attempt in 0..1000 {
        let candidate = parent.join(format!(
            "{file_name}.ffui-replace-backup.{job_id}.{timestamp}.{attempt}"
        ));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!(
        "{file_name}.ffui-replace-backup.{job_id}.{timestamp}.fallback"
    ))
}

fn mark_replace_original_failed(job: &mut TranscodeJob, message: String) {
    job.status = JobStatus::Failed;
    job.failure_reason = Some(message.clone());
    append_job_log_line(job, message);
}

fn trash_replaced_source(job: &mut TranscodeJob, source_path: &Path, media_label: &str) {
    match trash::delete(source_path) {
        Ok(()) => append_job_log_line(
            job,
            format!(
                "replace original: moved source {media_label} {} to recycle bin",
                source_path.display()
            ),
        ),
        Err(err) => append_job_log_line(
            job,
            format!(
                "replace original: warning: compressed output was finalized, but failed to move source {media_label} {} to recycle bin: {err}",
                source_path.display()
            ),
        ),
    }
}

fn log_renamed_compressed_output(job: &mut TranscodeJob, final_path: &Path) {
    append_job_log_line(
        job,
        format!(
            "replace original: renamed compressed output to {}",
            final_path.display()
        ),
    );
    job.output_path = Some(final_path.to_string_lossy().into_owned());
}

pub(crate) fn finalize_replace_original_output(
    job: &mut TranscodeJob,
    input_path: &Path,
    output_path: &Path,
    media_label: &str,
) -> PathBuf {
    let final_path = replacement_final_path(input_path, output_path);

    if output_path == final_path {
        return final_path;
    }

    if final_path != input_path && final_path.exists() {
        append_job_log_line(
            job,
            format!(
                "replace original: warning: final path {} already exists; keeping source {media_label} {} and staged output {}",
                final_path.display(),
                input_path.display(),
                output_path.display()
            ),
        );
        return output_path.to_path_buf();
    }

    if final_path == input_path {
        return finalize_same_path_replace(job, input_path, output_path, media_label);
    }

    match fs::rename(output_path, &final_path) {
        Ok(()) => {
            log_renamed_compressed_output(job, &final_path);
            trash_replaced_source(job, input_path, media_label);
            final_path
        }
        Err(err) => {
            mark_replace_original_failed(
                job,
                format!(
                    "replace original: failed to rename output {} -> {} before moving source {media_label} {}: {err}",
                    output_path.display(),
                    final_path.display(),
                    input_path.display()
                ),
            );
            output_path.to_path_buf()
        }
    }
}

fn finalize_same_path_replace(
    job: &mut TranscodeJob,
    input_path: &Path,
    output_path: &Path,
    media_label: &str,
) -> PathBuf {
    let backup_path = replace_original_backup_path(input_path, &job.id);
    match fs::rename(input_path, &backup_path) {
        Ok(()) => append_job_log_line(
            job,
            format!(
                "replace original: staged source {media_label} backup at {}",
                backup_path.display()
            ),
        ),
        Err(err) => {
            mark_replace_original_failed(
                job,
                format!(
                    "replace original: failed to stage source {media_label} backup {} -> {}: {err}",
                    input_path.display(),
                    backup_path.display()
                ),
            );
            return output_path.to_path_buf();
        }
    }

    match fs::rename(output_path, input_path) {
        Ok(()) => {
            log_renamed_compressed_output(job, input_path);
            trash_replaced_source(job, &backup_path, media_label);
            input_path.to_path_buf()
        }
        Err(err) => {
            let restore_message = match fs::rename(&backup_path, input_path) {
                Ok(()) => format!("source backup was restored to {}", input_path.display()),
                Err(restore_err) => format!(
                    "failed to restore source backup {} -> {}: {restore_err}",
                    backup_path.display(),
                    input_path.display()
                ),
            };
            mark_replace_original_failed(
                job,
                format!(
                    "replace original: failed to rename output {} -> {}; {restore_message}: {err}",
                    output_path.display(),
                    input_path.display()
                ),
            );
            output_path.to_path_buf()
        }
    }
}
