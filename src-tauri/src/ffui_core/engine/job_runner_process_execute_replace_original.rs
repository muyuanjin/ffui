fn apply_replace_original_video_output(
    job: &mut crate::ffui_core::domain::TranscodeJob,
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    final_output_path: &mut std::path::PathBuf,
) -> bool {
    let candidate_final = super::batch_compress::replacement_final_path(input_path, output_path);

    if output_path == candidate_final {
        *final_output_path = candidate_final;
        return true;
    } else {
        *final_output_path = super::batch_compress::finalize_replace_original_output(
            job,
            input_path,
            output_path,
            "video",
        );
    }
    !matches!(job.status, crate::ffui_core::domain::JobStatus::Failed)
}
