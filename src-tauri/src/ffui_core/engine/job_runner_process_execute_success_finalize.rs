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

#[cfg(test)]
mod execute_success_finalize_tests {
    use super::*;
    use crate::ffui_core::WaitMetadata;
    use crate::sync_ext::MutexExt;

    fn make_video_job(job_id: &str, last_progress_frame: u64) -> crate::ffui_core::domain::TranscodeJob {
        use crate::ffui_core::domain::{JobSource, JobStatus, JobType, MediaInfo, TranscodeJob};

        TranscodeJob {
            id: job_id.to_string(),
            filename: format!("C:/videos/{job_id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status: JobStatus::Processing,
            progress: 0.0,
            start_time: Some(1),
            end_time: None,
            processing_started_ms: Some(1),
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: None,
            created_time_ms: None,
            modified_time_ms: None,
            output_path: None,
            output_policy: None,
            ffmpeg_command: None,
            runs: Vec::new(),
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: None,
            }),
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: Some(WaitMetadata {
                last_progress_percent: None,
                processed_wall_millis: None,
                processed_seconds: None,
                target_seconds: None,
                progress_epoch: None,
                last_progress_out_time_seconds: None,
                last_progress_speed: None,
                last_progress_updated_at_ms: None,
                last_progress_frame: Some(last_progress_frame),
                tmp_output_path: None,
                segments: None,
                segment_end_targets: None,
            }),
        }
    }

    #[test]
    fn preset_stats_persistence_does_not_lose_updates_when_jobs_finish_concurrently() {
        use std::time::Duration;

        let dir = tempfile::tempdir().expect("temp dir");
        let _data_root_guard =
            crate::ffui_core::data_root::override_data_root_dir_for_tests(dir.path().to_path_buf());

        let preset = crate::test_support::make_ffmpeg_preset_for_tests("preset-1");
        let inner = std::sync::Arc::new(Inner::new(vec![preset], AppSettings::default()));

        let job_id_1 = "job-preset-stats-1".to_string();
        let job_id_2 = "job-preset-stats-2".to_string();
        {
            let mut state = inner.state.lock_unpoisoned();
            state
                .jobs
                .insert(job_id_1.clone(), make_video_job(&job_id_1, 100));
            state
                .jobs
                .insert(job_id_2.clone(), make_video_job(&job_id_2, 200));
        }

        let out_1 = dir.path().join("out-1.mp4");
        let out_2 = dir.path().join("out-2.mp4");

        let presets_path = crate::ffui_core::data_root::presets_path().expect("presets path");
        let save_blocker =
            crate::ffui_core::settings::presets::BlockFirstSavePresetsGuard::new(presets_path);

        let inner_a = inner.clone();
        let job_id_1_a = job_id_1.clone();
        let out_1_a = out_1.clone();
        let t1 = std::thread::spawn(move || {
            finalize_successful_transcode_job(
                inner_a.as_ref(),
                FinalizeSuccessfulTranscodeJobArgs {
                    job_id: &job_id_1_a,
                    preset_id: "preset-1",
                    output_path: &out_1_a,
                    original_size_bytes: 100 * 1024 * 1024,
                    final_output_size_bytes: 50 * 1024 * 1024,
                    elapsed: 10.0,
                    input_times: None,
                },
            )
            .expect("finalize job 1");
        });

        assert!(
            save_blocker.wait_first_entered(Duration::from_secs(2)),
            "expected first presets save to enter blocking section"
        );

        let inner_b = inner.clone();
        let job_id_2_b = job_id_2.clone();
        let out_2_b = out_2.clone();
        let t2 = std::thread::spawn(move || {
            finalize_successful_transcode_job(
                inner_b.as_ref(),
                FinalizeSuccessfulTranscodeJobArgs {
                    job_id: &job_id_2_b,
                    preset_id: "preset-1",
                    output_path: &out_2_b,
                    original_size_bytes: 200 * 1024 * 1024,
                    final_output_size_bytes: 120 * 1024 * 1024,
                    elapsed: 20.0,
                    input_times: None,
                },
            )
            .expect("finalize job 2");
        });

        // In the buggy implementation, job 2 can persist an updated snapshot while job 1 is
        // blocked, then job 1 overwrites the file with a stale snapshot. The fixed
        // implementation keeps persistence under the engine state lock so this second save
        // cannot happen until job 1 unblocks.
        let _second_save_seen =
            save_blocker.wait_call_count_at_least(2, Duration::from_secs(5));

        save_blocker.unblock_first();

        t1.join().expect("thread 1 join");
        t2.join().expect("thread 2 join");

        let loaded = crate::ffui_core::settings::load_presets().expect("load presets");
        let preset = loaded
            .iter()
            .find(|p| p.id == "preset-1")
            .expect("preset-1 present");

        assert_eq!(preset.stats.usage_count, 2);
        assert!((preset.stats.total_input_size_mb - 300.0).abs() < f64::EPSILON);
        assert!((preset.stats.total_output_size_mb - 170.0).abs() < f64::EPSILON);
        // `total_time_seconds` is accumulated as wall-clock "preset active" time,
        // so this finalize-only test (which does not drive worker start/stop
        // transitions) should not change it.
        assert!((preset.stats.total_time_seconds - 0.0).abs() < f64::EPSILON);
        assert!((preset.stats.total_frames - 300.0).abs() < f64::EPSILON);
    }
}
