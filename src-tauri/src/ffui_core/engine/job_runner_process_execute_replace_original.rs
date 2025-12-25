fn apply_replace_original_video_output(
    job: &mut crate::ffui_core::domain::TranscodeJob,
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    final_output_path: &mut std::path::PathBuf,
) {
    let final_dir = input_path
        .parent().map_or_else(|| std::path::PathBuf::from("."), std::path::Path::to_path_buf);
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    let candidate_final = final_dir.join(format!("{stem}.{ext}"));

    match trash::delete(input_path) {
        Ok(()) => super::worker_utils::append_job_log_line(
            job,
            format!(
                "replace original: moved source video {} to recycle bin",
                input_path.display()
            ),
        ),
        Err(err) => super::worker_utils::append_job_log_line(
            job,
            format!(
                "replace original: failed to move source video {} to recycle bin: {err}",
                input_path.display()
            ),
        ),
    }

    if output_path == candidate_final {
        *final_output_path = candidate_final;
    } else {
        match std::fs::rename(output_path, &candidate_final) {
            Ok(()) => {
                super::worker_utils::append_job_log_line(
                    job,
                    format!(
                        "replace original: renamed compressed output to {}",
                        candidate_final.display()
                    ),
                );
                job.output_path = Some(candidate_final.to_string_lossy().into_owned());
                *final_output_path = candidate_final;
            }
            Err(err) => super::worker_utils::append_job_log_line(
                job,
                format!(
                    "replace original: failed to rename output {} -> {}: {err}",
                    output_path.display(),
                    candidate_final.display()
                ),
            ),
        }
    }
}
