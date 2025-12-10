// ============================================================================
// Progress tracking and logging
// ============================================================================

// Keep a compact textual tail of recent logs for each job so the UI can show
// diagnostics without unbounded memory growth. The actual log lines live in
// `job.logs`; this helper just materializes a truncated string view.
const MAX_LOG_TAIL_BYTES: usize = 16 * 1024;

pub(super) fn recompute_log_tail(job: &mut TranscodeJob) {
    if job.logs.is_empty() {
        job.log_tail = None;
        return;
    }

    let joined = job.logs.join("\n");
    if joined.len() > MAX_LOG_TAIL_BYTES {
        let start = joined.len().saturating_sub(MAX_LOG_TAIL_BYTES);
        job.log_tail = Some(joined[start..].to_string());
    } else {
        job.log_tail = Some(joined);
    }
}

pub(super) fn update_job_progress(
    inner: &Inner,
    job_id: &str,
    percent: Option<f64>,
    log_line: Option<&str>,
    _speed: Option<f64>,
) {
    let mut should_notify = false;
    let now_ms = super::worker_utils::current_time_millis();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            // 更新累计已用时间：基于 start_time 计算当前段的时间，加上之前暂停时累积的时间
            if job.status == JobStatus::Processing && let Some(start) = job.start_time {
                // 计算当前段的已用时间
                let current_segment_ms = now_ms.saturating_sub(start);
                // 如果有之前暂停时保存的累计时间（存储在 wait_metadata 中），则加上
                let previous_elapsed = job
                    .wait_metadata
                    .as_ref()
                    .and_then(|m| m.processed_seconds)
                    .map(|s| (s * 1000.0) as u64)
                    .unwrap_or(0);
                job.elapsed_ms = Some(previous_elapsed + current_segment_ms);
            }

            if let Some(p) = percent {
                // Clamp progress into [0, 100] and ensure it never regresses so
                // the UI sees a monotonic percentage.
                let clamped = p.clamp(0.0, 100.0);
                if clamped > job.progress {
                    job.progress = clamped;
                    if job.status == JobStatus::Processing
                        && let Some(meta) = job.wait_metadata.as_mut()
                    {
                        meta.last_progress_percent = Some(job.progress);
                        if let Some(total) =
                            job.media_info.as_ref().and_then(|m| m.duration_seconds)
                            && total.is_finite()
                            && total > 0.0
                            && job.progress.is_finite()
                        {
                            let frac = (job.progress / 100.0).clamp(0.0, 1.0);
                            meta.processed_seconds = Some(total * frac);
                        }
                    }
                    should_notify = true;
                }
            }
            if let Some(line) = log_line {
                // Ignore empty/whitespace-only lines that come from ffmpeg's
                // structured `-progress` output separators. These previously
                // polluted the job logs with大量空白行, making the task detail
                // view hard to read without improving diagnostics, while also
                // generating noisy queue snapshots with no useful content.
                if !line.trim().is_empty() {
                    // Keep only a small rolling window of logs to avoid unbounded growth.
                    if job.logs.len() > 200 {
                        job.logs.drain(0..job.logs.len() - 200);
                    }
                    job.logs.push(line.to_string());
                    recompute_log_tail(job);

                    // Even when ffmpeg does not emit the traditional "time=... speed=..."
                    // progress lines (for example due to loglevel changes or custom
                    // builds), the UI still needs to see streaming log output, the
                    // resolved ffmpeg command, and any media metadata / preview paths.
                    //
                    // To avoid the "no progress / no logs until cancel or completion"
                    // regression, emit a queue snapshot whenever we append a log line
                    // while the job is actively processing. This trades a modest
                    // increase in event frequency for correct, real-time feedback.
                    if job.status == JobStatus::Processing {
                        should_notify = true;
                    }
                }
            }
        }
    }

    // Emit queue snapshots only when progress actually moves forward so the
    // event stream stays efficient while remaining responsive. Log-only
    // updates for processing jobs are also allowed to trigger snapshots so
    // the frontend can show live ffmpeg output even if no percentage can be
    // derived from the current stderr line.
    if should_notify {
        notify_queue_listeners(inner);
    }
}
