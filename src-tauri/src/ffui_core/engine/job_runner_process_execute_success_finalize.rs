struct FinalizeSuccessfulTranscodeJobArgs<'a> {
    job_id: &'a str,
    preset_id: &'a str,
    output_path: &'a std::path::Path,
    original_size_bytes: u64,
    final_output_size_bytes: u64,
    elapsed: f64,
    input_times: Option<super::file_times::FileTimesSnapshot>,
}

fn compute_final_elapsed_ms(job: &crate::ffui_core::domain::TranscodeJob, now_ms: u64) -> Option<u64> {
    let start = job.processing_started_ms.or(job.start_time)?;
    let current_segment_ms = now_ms.saturating_sub(start);
    let previous_wall_ms = job
        .wait_metadata
        .as_ref()
        .and_then(|meta| meta.processed_wall_millis)
        .unwrap_or(0);
    Some(
        previous_wall_ms
            .saturating_add(current_segment_ms)
            .max(job.elapsed_ms.unwrap_or(0)),
    )
}

fn finalize_successful_transcode_job(
    inner: &Inner,
    args: FinalizeSuccessfulTranscodeJobArgs<'_>,
) -> Result<()> {
    let FinalizeSuccessfulTranscodeJobArgs {
        job_id,
        preset_id,
        output_path,
        original_size_bytes,
        final_output_size_bytes,
        elapsed,
        input_times,
    } = args;
    // 后续逻辑中，final_output_path 代表对用户可见的“最终输出路径”。
    // 对于非 Batch Compress 场景，它与 output_path 相同；对于启用了
    // “替换原文件”的 Batch Compress 任务，可能会在下方被更新为去掉
    // `.compressed` 后的路径（同时原文件被移入回收站）。
    let mut final_output_path = output_path.to_path_buf();
    let mut replacement_failed = false;

    let mut frames_processed: f64 = 0.0;
    {
        let mut state = inner.state.lock_unpoisoned();

        // 先基于不可变快照计算是否需要替换原文件以及相关路径，避免在同一作用域内
        // 同时对 state 进行可变和不可变借用。
        let replace_plan: Option<(std::path::PathBuf, std::path::PathBuf)> = {
            let job_snapshot = state.jobs.get(job_id).cloned();
            if let Some(job_snapshot) = job_snapshot
                && matches!(
                    job_snapshot.source,
                    crate::ffui_core::domain::JobSource::BatchCompress
                )
                && matches!(
                    job_snapshot.job_type,
                    crate::ffui_core::domain::JobType::Video
                )
            {
                let replace_original = job_snapshot
                    .batch_id
                    .as_ref()
                    .and_then(|batch_id| state.batch_compress_batches.get(batch_id))
                    .map(|batch| batch.replace_original)
                    .unwrap_or_else(|| {
                        job_snapshot
                            .batch_compress_saving_condition
                            .and_then(|saving| saving.replace_original)
                            .unwrap_or(false)
                    });

                if replace_original
                    && let (Some(ref input_str), Some(ref output_str)) =
                        (job_snapshot.input_path.as_ref(), job_snapshot.output_path.as_ref())
                {
                    Some((
                        std::path::PathBuf::from(input_str),
                        std::path::PathBuf::from(output_str),
                    ))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Completed;
            job.progress = 100.0;
            let now_ms = current_time_millis();
            job.end_time = Some(now_ms);
            job.elapsed_ms = compute_final_elapsed_ms(job, now_ms).or(job.elapsed_ms);
            if original_size_bytes > 0 && final_output_size_bytes > 0 {
                job.output_size_mb = Some(final_output_size_bytes as f64 / (1024.0 * 1024.0));
            }

            if matches!(job.job_type, crate::ffui_core::domain::JobType::Video) {
                let has_segments = job
                    .wait_metadata
                    .as_ref()
                    .and_then(|meta| meta.segments.as_ref())
                    .map(|segments| !segments.is_empty())
                    .unwrap_or(false);

                if !has_segments
                    && let Some(frame) = job
                        .wait_metadata
                        .as_ref()
                        .and_then(|meta| meta.last_progress_frame)
                    && frame > 0
                {
                    frames_processed = frame as f64;
                }

                if frames_processed <= 0.0
                    && let Some(info) = job.media_info.as_ref()
                    && let (Some(duration), Some(frame_rate)) = (info.duration_seconds, info.frame_rate)
                    && duration > 0.0
                    && frame_rate > 0.0
                {
                    frames_processed = duration * frame_rate;
                }
            }

            job.wait_metadata = None;

            if let Some((input_path_buf, output_path_buf)) = replace_plan {
                replacement_failed = !apply_replace_original_video_output(
                    job,
                    &input_path_buf,
                    &output_path_buf,
                    &mut final_output_path,
                );
                if replacement_failed {
                    job.progress = 100.0;
                    job.end_time.get_or_insert_with(current_time_millis);
                    job.elapsed_ms = compute_final_elapsed_ms(job, current_time_millis())
                        .or(job.elapsed_ms);
                    job.wait_metadata = None;
                }
            }

            if !replacement_failed {
                super::worker_utils::append_job_log_line(
                    job,
                    format!(
                        "Completed in {:.1}s, output size {:.2} MB",
                        job.elapsed_ms.map(|ms| ms as f64 / 1000.0).unwrap_or(elapsed),
                        job.output_size_mb.unwrap_or(0.0)
                    ),
                );
            }
        }
        // Update preset statistics for completed jobs.
        if !replacement_failed
            && original_size_bytes > 0
            && final_output_size_bytes > 0
            && elapsed > 0.0
        {
            let input_mb = original_size_bytes as f64 / (1024.0 * 1024.0);
            let output_mb = final_output_size_bytes as f64 / (1024.0 * 1024.0);
            let presets = std::sync::Arc::make_mut(&mut state.presets);
            if let Some(preset) = presets.iter_mut().find(|p| p.id == preset_id) {
                preset.stats.usage_count += 1;
                preset.stats.total_input_size_mb += input_mb;
                preset.stats.total_output_size_mb += output_mb;
                if frames_processed > 0.0 {
                    preset.stats.total_frames += frames_processed;
                }
            }
            // Persist the updated preset stats while holding the engine state lock.
            // This avoids out-of-order stale snapshots overwriting newer updates
            // when multiple jobs complete concurrently.
            if let Err(err) = crate::ffui_core::settings::save_presets(presets) {
                crate::debug_eprintln!("failed to persist presets after stats update: {err:#}");
            }
        }
    }

    if replacement_failed {
        super::state::notify_queue_lite_delta_for_job_terminal_state(inner, job_id);
        mark_batch_compress_child_processed(inner, job_id);
        return Ok(());
    }

    set_job_progress_phase(inner, job_id, ProgressPhase::Completed, None);
    super::state::notify_queue_lite_delta_for_job_terminal_state(inner, job_id);

    if let Some(times) = input_times.as_ref()
        && let Err(err) = super::file_times::apply_file_times(&final_output_path, times)
    {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "preserve file times: failed to apply timestamps to {}: {err}",
                    final_output_path.display()
                ),
            );
        }
    }

    // 记录所有成功生成的最终输出路径,供 Batch Compress 在后续批次中进行去重与跳过。
    register_known_batch_compress_output_with_inner(inner, &final_output_path);

    mark_batch_compress_child_processed(inner, job_id);

    Ok(())
}
