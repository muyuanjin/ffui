// ============================================================================
// Progress tracking and logging
// ============================================================================

use super::transcode_activity;
use super::worker_utils::append_job_log_line;

pub(super) fn update_job_progress(
    inner: &Inner,
    job_id: &str,
    percent: Option<f64>,
    log_line: Option<&str>,
    _speed: Option<f64>,
) {
    let mut should_notify = false;
    let mut should_record_activity = false;
    let now_ms = current_time_millis();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            // 更新累计已用时间：基于 processing_started_ms 计算当前段的时间，加上之前暂停时累积的时间
            if job.status == JobStatus::Processing {
                should_record_activity = true;
                let baseline = job
                    .processing_started_ms
                    .or(job.start_time)
                    .unwrap_or(now_ms);
                let current_segment_ms = now_ms.saturating_sub(baseline);
                // 使用暂停时记录的“墙钟累计耗时”作为基线，确保 elapsed_ms 始终表示真实跑 ffmpeg
                // 的时间，而不是媒体进度（duration * progress）。
                let previous_wall_ms = job
                    .wait_metadata
                    .as_ref()
                    .and_then(|m| m.processed_wall_millis)
                    .unwrap_or(0);
                job.elapsed_ms = Some(previous_wall_ms + current_segment_ms);
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
                    append_job_log_line(job, line.to_string());

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

    if should_record_activity {
        transcode_activity::record_processing_activity(inner);
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
