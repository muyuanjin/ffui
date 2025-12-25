// ============================================================================
// Job state queries
// ============================================================================

pub(super) fn is_job_cancelled(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock_unpoisoned();
    state.cancelled_jobs.contains(job_id)
}

pub(super) fn is_job_wait_requested(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock_unpoisoned();
    state.wait_requests.contains(job_id)
}

// ============================================================================
// Job state transitions
// ============================================================================

pub(super) fn mark_job_waiting(
    inner: &Inner,
    job_id: &str,
    tmp_output: &Path,
    output_path: &Path,
    total_duration: Option<f64>,
    processed_seconds_override: Option<f64>,
) -> Result<()> {
    let tmp_str = tmp_output.to_string_lossy().into_owned();
    let output_str = output_path.to_string_lossy().into_owned();
    let now_ms = current_time_millis();

    {
        let mut state = inner.state.lock_unpoisoned();
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Paused;

            // 保存暂停时的累计已用时间（墙钟毫秒），避免后续用媒体进度推导
            //
            // 对于第一次“暂停”（没有 wait_metadata）场景，elapsed_ms 通常已经由
            // update_job_progress 基于 processing_started_ms 持续维护，直接作为
            // 基线会和下面按 start_time/processing_started_ms 计算的 current_segment_ms
            // 形成“双倍计时”（baseline + 当前段完整耗时）。为避免这种重复累加，
            // 仅在存在历史 wait_metadata 时才回退到 elapsed_ms。
            let previous_wall_ms = match job.wait_metadata.as_ref() {
                Some(meta) => meta
                    .processed_wall_millis
                    .or(job.elapsed_ms)
                    .unwrap_or(0),
                None => 0,
            };
            let current_segment_ms = job
                .processing_started_ms
                .or(job.start_time)
                .map_or(0, |start| now_ms.saturating_sub(start));
            let elapsed_wall_ms = previous_wall_ms + current_segment_ms;
            job.elapsed_ms = Some(elapsed_wall_ms);

            let percent = if job.progress.is_finite() && job.progress >= 0.0 {
                Some(job.progress)
            } else {
                None
            };

            let media_duration = job
                .media_info
                .as_ref()
                .and_then(|m| m.duration_seconds)
                .or(total_duration);

            let mut processed_seconds = if let Some(v) = processed_seconds_override
                && v.is_finite()
                && v > 0.0
            {
                Some(v)
            } else {
                match (percent, media_duration) {
                    (Some(p), Some(total))
                        if p.is_finite() && total.is_finite() && p > 0.0 && total > 0.0 =>
                    {
                        Some((p / 100.0) * total)
                    }
                    _ => None,
                }
            };

            // 累积所有暂停产生的分段路径，支持多次“暂停→继续”后进行多段 concat。
            let mut segments: Vec<String> = job
                .wait_metadata
                .as_ref()
                .and_then(|m| m.segments.clone())
                .unwrap_or_default();

            // 兼容旧快照：如果之前只记录了 tmp_output_path 而没有 segments，
            // 则将其作为第一段补入列表。
            if segments.is_empty()
                && let Some(prev_tmp) = job
                    .wait_metadata
                    .as_ref()
                    .and_then(|m| m.tmp_output_path.as_ref())
                && !prev_tmp.is_empty()
                && prev_tmp != &tmp_str
            {
                segments.push(prev_tmp.clone());
            }

            if segments.last() != Some(&tmp_str) {
                segments.push(tmp_str.clone());
            }

            // Track per-segment join targets (end times) so we can generate a
            // concat list with explicit durations. This avoids relying on
            // container-derived per-file durations which can drift by 1–2 frames
            // for VFR/B-frame sources.
            let previous_segments_len = job
                .wait_metadata
                .as_ref()
                .and_then(|m| m.segments.as_ref().map(std::vec::Vec::len))
                .or_else(|| {
                    job.wait_metadata
                        .as_ref()
                        .and_then(|m| m.tmp_output_path.as_ref())
                        .map(|_| 1)
                })
                .unwrap_or(0);

            let mut segment_end_targets: Vec<f64> = job
                .wait_metadata
                .as_ref()
                .and_then(|m| m.segment_end_targets.clone())
                .unwrap_or_default();

            let targets_reliable = !segment_end_targets.is_empty()
                && (segment_end_targets.len() == previous_segments_len
                    || segment_end_targets.len() + 1 == previous_segments_len);
            if !targets_reliable {
                segment_end_targets.clear();
                // Best-effort backfill for single-segment legacy snapshots.
                if previous_segments_len <= 1
                    && let Some(prev) = job
                        .wait_metadata
                        .as_ref()
                        .and_then(|m| m.target_seconds)
                        .filter(|v| v.is_finite() && *v > 0.0)
                {
                    segment_end_targets.push(prev);
                }
            }

            let end = processed_seconds.filter(|v| v.is_finite() && *v > 0.0);
            let prev_target = segment_end_targets.last().copied();
            if let Some(end) = end
                && segment_end_targets.len() + 1 == segments.len()
                && segment_end_targets
                    .last()
                    .is_none_or(|v| (*v - end).abs() > 1e-9)
            {
                segment_end_targets.push(end);
            } else if !segment_end_targets.is_empty()
                && segment_end_targets.len() + 1 == segments.len()
                && let Some(prev) = prev_target
                && (end.is_none() || end.unwrap_or(prev) <= prev + 1e-9)
            {
                // If the pause boundary did not advance beyond the previously
                // recorded join target, keep concat metadata aligned by dropping
                // the newly-created "zero progress" segment.
                if segments.last() == Some(&tmp_str) {
                    segments.pop();
                }
                if processed_seconds.is_none() {
                    processed_seconds = Some(prev);
                }
            }

            let tmp_output_path_for_meta = segments
                .last()
                .cloned()
                .unwrap_or_else(|| tmp_str.clone());
            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: percent,
                processed_wall_millis: Some(elapsed_wall_ms),
                processed_seconds,
                target_seconds: processed_seconds,
                last_progress_out_time_seconds: None,
                last_progress_frame: None,
                tmp_output_path: Some(tmp_output_path_for_meta),
                segments: Some(segments),
                segment_end_targets: (!segment_end_targets.is_empty()).then_some(segment_end_targets),
            });

            if job.output_path.is_none() {
                job.output_path = Some(output_str);
            }

            // Jobs in a paused/waiting-with-progress state are intentionally
            // kept out of the scheduling queue until an explicit resume
            // command re-enqueues them.
            state.queue.retain(|id| id != job_id);

            state.wait_requests.remove(job_id);
            state.cancelled_jobs.remove(job_id);
        }
    }

    notify_queue_listeners(inner);
    mark_batch_compress_child_processed(inner, job_id);
    Ok(())
}

pub(super) fn collect_wait_metadata_cleanup_paths(meta: &WaitMetadata) -> Vec<PathBuf> {
    use std::collections::HashSet;

    let mut raw_paths: Vec<&str> = Vec::new();
    if let Some(segs) = meta.segments.as_ref()
        && !segs.is_empty()
    {
        raw_paths.extend(segs.iter().map(std::string::String::as_str));
    } else if let Some(tmp) = meta.tmp_output_path.as_ref() {
        raw_paths.push(tmp.as_str());
    }

    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for raw in raw_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        if seen.insert(path.clone()) {
            out.push(path.clone());
        }
        let marker = noaudio_marker_path_for_segment(path.as_path());
        if seen.insert(marker.clone()) {
            out.push(marker);
        }
    }
    out
}

pub(super) fn mark_job_cancelled(inner: &Inner, job_id: &str) -> Result<()> {
    let mut cleanup_paths: Vec<PathBuf> = Vec::new();

    {
        let mut state = inner.state.lock_unpoisoned();
        let restart_after_cancel = state.restart_requests.remove(job_id);

        if let Some(job) = state.jobs.get_mut(job_id) {
            if let Some(meta) = job.wait_metadata.as_ref() {
                cleanup_paths.extend(collect_wait_metadata_cleanup_paths(meta));
            }
            if restart_after_cancel {
                // Reset the job back to Waiting with 0% progress and enqueue
                // it for a fresh run from the beginning.
                job.status = JobStatus::Waiting;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                super::worker_utils::append_job_log_line(
                    job,
                    "Restart requested from UI; job will re-run from 0%".to_string(),
                );

                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
            } else {
                job.status = JobStatus::Cancelled;
                job.progress = 0.0;
                job.end_time = Some(current_time_millis());
                super::worker_utils::append_job_log_line(job, "Cancelled by user".to_string());
                job.wait_metadata = None;
            }
        }

        state.cancelled_jobs.remove(job_id);
    }

    for path in cleanup_paths {
        let _ = fs::remove_file(path);
    }

    // Notify listeners that the job has transitioned to Cancelled or has been
    // reset for a fresh restart.
    notify_queue_listeners(inner);
    // Wake at least one worker in case a restart enqueued a new job.
    inner.cv.notify_one();
    mark_batch_compress_child_processed(inner, job_id);
    Ok(())
}
