struct FinalizeSuccessfulTranscodeJobArgs<'a> {
    job_id: &'a str,
    preset_id: &'a str,
    output_path: &'a std::path::Path,
    original_size_bytes: u64,
    final_output_size_bytes: u64,
    elapsed: f64,
    input_times: Option<super::file_times::FileTimesSnapshot>,
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

    let mut presets_to_persist: Option<std::sync::Arc<Vec<_>>> = None;
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
                if let Some(batch_id) = job_snapshot.batch_id.clone()
                    && let Some(batch) = state.batch_compress_batches.get(&batch_id)
                    && batch.replace_original
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
            // 最终累计耗时：优先保留 update_job_progress 已维护的 elapsed_ms（基于墙钟时间），
            // 仅在缺失时回退到 processing_started_ms/start_time 差值，避免重复累加当前段。
            if job.elapsed_ms.is_none()
                && let Some(start) = job.processing_started_ms.or(job.start_time)
                && now_ms > start
            {
                job.elapsed_ms = Some(now_ms.saturating_sub(start));
            }
            if original_size_bytes > 0 && final_output_size_bytes > 0 {
                job.output_size_mb = Some(final_output_size_bytes as f64 / (1024.0 * 1024.0));
            }
            job.wait_metadata = None;

            if let Some((input_path_buf, output_path_buf)) = replace_plan {
                apply_replace_original_video_output(
                    job,
                    &input_path_buf,
                    &output_path_buf,
                    &mut final_output_path,
                );
            }

            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "Completed in {:.1}s, output size {:.2} MB",
                    elapsed,
                    job.output_size_mb.unwrap_or(0.0)
                ),
            );
        }
        // Update preset statistics for completed jobs.
        if original_size_bytes > 0 && final_output_size_bytes > 0 && elapsed > 0.0 {
            let input_mb = original_size_bytes as f64 / (1024.0 * 1024.0);
            let output_mb = final_output_size_bytes as f64 / (1024.0 * 1024.0);
            let presets = std::sync::Arc::make_mut(&mut state.presets);
            if let Some(preset) = presets.iter_mut().find(|p| p.id == preset_id) {
                preset.stats.usage_count += 1;
                preset.stats.total_input_size_mb += input_mb;
                preset.stats.total_output_size_mb += output_mb;
                preset.stats.total_time_seconds += elapsed;
            }
            presets_to_persist = Some(state.presets.clone());
        }
    }

    if let Some(presets_to_persist) = presets_to_persist {
        drop(crate::ffui_core::settings::save_presets(
            presets_to_persist.as_ref(),
        ));
    }

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
