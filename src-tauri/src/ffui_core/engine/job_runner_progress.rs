// ============================================================================
// Progress tracking and logging
// ============================================================================

use super::transcode_activity;
use super::state::{notify_queue_lite_delta_listeners, persist_queue_state_lite_best_effort};
use super::worker_utils::{append_job_log_line, should_record_job_log_line};
use crate::ffui_core::{QueueStateLiteDelta, TranscodeJobLiteDeltaPatch};

const PROGRESS_PERSIST_MIN_INTERVAL_MS: u64 = 1000;

pub(super) fn update_job_progress(
    inner: &Inner,
    job_id: &str,
    percent: Option<f64>,
    progress_out_time_seconds: Option<f64>,
    progress_frame: Option<u64>,
    log_line: Option<&str>,
    speed: Option<f64>,
) {
    let mut should_notify = false;
    let mut progress_changed = false;
    let mut telemetry_changed = false;
    let mut should_record_activity = false;
    let now_ms = current_time_millis();
    let mut delta_to_emit: Option<QueueStateLiteDelta> = None;
    let mut should_persist_snapshot = false;

    {
        let mut state = inner.state.lock_unpoisoned();
        let base_snapshot_revision = state.queue_snapshot_revision;
        let last_persist_snapshot_at_ms = state.last_queue_persist_snapshot_at_ms;
        let mut next_persist_snapshot_at_ms: Option<u64> = None;
        let mut pending_patch: Option<TranscodeJobLiteDeltaPatch> = None;

        if let Some(job) = state.jobs.get_mut(job_id) {
            // 更新累计已用时间：基于 processing_started_ms 计算当前段的时间，加上之前暂停时累积的时间
            if job.status == JobStatus::Processing {
                should_record_activity = true;
                let baseline = job
                    .processing_started_ms
                    .or(job.start_time)
                    .unwrap_or(now_ms);
                let current_segment_ms = now_ms.saturating_sub(baseline);
                let previous_wall_ms = job
                    .wait_metadata
                    .as_ref()
                    .and_then(|m| m.processed_wall_millis)
                    .unwrap_or(0);
                job.elapsed_ms = Some(previous_wall_ms + current_segment_ms);
            }

            if job.status == JobStatus::Processing {
                if let Some(out_time) = progress_out_time_seconds
                    && out_time.is_finite()
                    && out_time >= 0.0
                    && let Some(meta) = job.wait_metadata.as_mut()
                {
                    let changed = meta
                        .last_progress_out_time_seconds
                        .is_none_or(|prev| (prev - out_time).abs() > 0.000_001);
                    if changed {
                        meta.last_progress_out_time_seconds = Some(out_time);
                        meta.last_progress_updated_at_ms = Some(now_ms);
                        telemetry_changed = true;
                    } else if meta.last_progress_updated_at_ms.is_none() {
                        meta.last_progress_updated_at_ms = Some(now_ms);
                        telemetry_changed = true;
                    }

                    if let Some(v) = speed
                        && v.is_finite()
                        && v > 0.0
                    {
                        let changed = meta
                            .last_progress_speed
                            .is_none_or(|prev| (prev - v).abs() > 0.000_001);
                        if changed {
                            meta.last_progress_speed = Some(v);
                            meta.last_progress_updated_at_ms = Some(now_ms);
                            telemetry_changed = true;
                        }
                    }
                }

                if let Some(frame) = progress_frame
                    && let Some(meta) = job.wait_metadata.as_mut()
                {
                    let changed = meta
                        .last_progress_frame
                        .is_none_or(|prev| prev != frame);
                    if changed {
                        meta.last_progress_frame = Some(frame);
                    }
                }
            }

            if let Some(p) = percent {
                let clamped = p.clamp(0.0, 100.0);
                if clamped > job.progress {
                    job.progress = clamped;
                    progress_changed = true;
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

            if let Some(line) = log_line && should_record_job_log_line(line) {
                append_job_log_line(job, line.to_string());
            }

            if job.status == JobStatus::Processing {
                let elapsed = now_ms.saturating_sub(last_persist_snapshot_at_ms);
                if last_persist_snapshot_at_ms == 0
                    || elapsed >= PROGRESS_PERSIST_MIN_INTERVAL_MS
                {
                    next_persist_snapshot_at_ms = Some(now_ms);
                    should_persist_snapshot = true;
                }
            }

            if telemetry_changed {
                should_notify = true;
            }

            if should_notify {
                let (progress_out_time_seconds, progress_speed, progress_updated_at_ms, progress_epoch) =
                    job.wait_metadata.as_ref().map_or((None, None, None, None), |m| {
                        (
                            m.last_progress_out_time_seconds,
                            m.last_progress_speed,
                            m.last_progress_updated_at_ms,
                            m.progress_epoch,
                        )
                    });
                pending_patch = Some(TranscodeJobLiteDeltaPatch {
                    id: job.id.clone(),
                    status: Some(job.status),
                    progress: progress_changed.then_some(job.progress),
                    progress_out_time_seconds,
                    progress_speed,
                    progress_updated_at_ms,
                    progress_epoch,
                    elapsed_ms: progress_changed.then_some(job.elapsed_ms).flatten(),
                    preview_path: None,
                    preview_revision: None,
                });
            }
        }

        if let Some(next) = next_persist_snapshot_at_ms {
            state.last_queue_persist_snapshot_at_ms = next;
        }

        if let Some(patch) = pending_patch {
            state.queue_delta_revision = state.queue_delta_revision.saturating_add(1);
            let delta_revision = state.queue_delta_revision;
            delta_to_emit = Some(QueueStateLiteDelta {
                base_snapshot_revision,
                delta_revision,
                patches: vec![patch],
            });
        }
    }

    if should_record_activity {
        transcode_activity::record_processing_activity(inner);
    }

    if let Some(delta) = delta_to_emit {
        notify_queue_lite_delta_listeners(inner, delta);
    }

    if should_persist_snapshot {
        persist_queue_state_lite_best_effort(inner);
    }
}
