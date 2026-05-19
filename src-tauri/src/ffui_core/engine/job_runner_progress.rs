// ============================================================================
// Progress tracking and logging
// ============================================================================

use super::transcode_activity;
use super::state::{notify_queue_lite_delta_listeners, persist_queue_state_lite_best_effort};
use super::worker_utils::{append_job_log_line, should_record_job_log_line};
use crate::ffui_core::{
    ProgressPhaseTelemetry, QueueStateLiteDelta, TranscodeJobLiteDeltaPatch,
    TranscodeJobLiteTelemetryDelta,
};

const PROGRESS_PERSIST_MIN_INTERVAL_MS: u64 = 1000;

pub(super) fn compute_phase_eta_ms(
    duration_seconds: Option<f64>,
    out_time_seconds: Option<f64>,
    speed: Option<f64>,
) -> Option<u64> {
    let duration = duration_seconds.filter(|v| v.is_finite() && *v > 0.0)?;
    let out_time = out_time_seconds.filter(|v| v.is_finite() && *v >= 0.0)?;
    let speed = speed.filter(|v| v.is_finite() && *v > 0.0)?;
    let remaining = (duration - out_time).max(0.0);
    Some(((remaining / speed) * 1000.0).round() as u64)
}

pub(super) fn compute_phase_progress(
    duration_seconds: Option<f64>,
    out_time_seconds: Option<f64>,
) -> Option<f64> {
    let duration = duration_seconds.filter(|v| v.is_finite() && *v > 0.0)?;
    let out_time = out_time_seconds.filter(|v| v.is_finite() && *v >= 0.0)?;
    Some(((out_time / duration) * 100.0).clamp(0.0, 100.0))
}

pub(super) fn set_job_progress_phase(
    inner: &Inner,
    job_id: &str,
    phase: ProgressPhase,
    duration_seconds: Option<f64>,
) {
    let now_ms = current_time_millis();
    emit_job_progress_phase(
        inner,
        job_id,
        ProgressPhaseTelemetry {
            progress_phase: Some(phase),
            phase_progress: if matches!(phase, ProgressPhase::Completed) {
                Some(100.0)
            } else {
                duration_seconds
                    .filter(|v| v.is_finite() && *v > 0.0)
                    .map(|_| 0.0)
            },
            phase_out_time_seconds: None,
            phase_duration_seconds: duration_seconds.filter(|v| v.is_finite() && *v > 0.0),
            phase_speed: None,
            phase_updated_at_ms: Some(now_ms),
            phase_eta_ms: None,
        },
    );
}

fn emit_job_progress_phase(inner: &Inner, job_id: &str, telemetry: ProgressPhaseTelemetry) {
    let delta = {
        let mut state = inner.state.lock_unpoisoned();
        let (progress, processing_started_ms, elapsed_ms) = {
            let Some(job) = state.jobs.get_mut(job_id) else {
                return;
            };
            let phase = telemetry.progress_phase;
            let should_mark_primary_done = matches!(
                phase,
                Some(
                    ProgressPhase::Concatenating
                        | ProgressPhase::AudioFinalizing
                        | ProgressPhase::Muxing
                        | ProgressPhase::Completed
                )
            );
            if should_mark_primary_done && job.progress < 100.0 {
                job.progress = 100.0;
                if let Some(meta) = job.wait_metadata.as_mut() {
                    meta.last_progress_percent = Some(100.0);
                }
                (
                    Some(100.0),
                    job.processing_started_ms,
                    job.elapsed_ms,
                )
            } else {
                (
                    None,
                    job.processing_started_ms,
                    job.elapsed_ms,
                )
            }
        };
        state
            .progress_phase_by_job
            .insert(job_id.to_string(), telemetry.clone());
        state.queue_delta_revision = state.queue_delta_revision.saturating_add(1);
        QueueStateLiteDelta {
            base_snapshot_revision: state.queue_snapshot_revision,
            delta_revision: state.queue_delta_revision,
            patches: vec![TranscodeJobLiteDeltaPatch {
                id: job_id.to_string(),
                status: None,
                processing_started_ms,
                progress,
                skip_reason: None,
                telemetry: Some(TranscodeJobLiteTelemetryDelta {
                    progress_epoch: None,
                    last_progress_out_time_seconds: None,
                    last_progress_speed: None,
                    last_progress_updated_at_ms: None,
                    last_progress_frame: None,
                    phase: telemetry,
                }),
                elapsed_ms,
                preview: None,
            }],
        }
    };
    notify_queue_lite_delta_listeners(inner, delta);
}

fn update_job_progress_phase_sample(
    inner: &Inner,
    job_id: &str,
    out_time_seconds: Option<f64>,
    speed: Option<f64>,
) {
    if out_time_seconds.is_none() && speed.is_none() {
        return;
    }
    let now_ms = current_time_millis();
    let delta = {
        let mut state = inner.state.lock_unpoisoned();
        let Some(job) = state.jobs.get(job_id) else {
            return;
        };
        if job.status != JobStatus::Processing {
            return;
        }
        let processing_started_ms = job.processing_started_ms;
        let elapsed_ms = job.elapsed_ms;
        let Some(phase) = state.progress_phase_by_job.get_mut(job_id) else {
            return;
        };

        if let Some(out_time) = out_time_seconds
            && out_time.is_finite()
            && out_time >= 0.0
        {
            phase.phase_out_time_seconds = Some(out_time);
        }
        if let Some(v) = speed
            && v.is_finite()
            && v > 0.0
        {
            phase.phase_speed = Some(v);
        }
        phase.phase_updated_at_ms = Some(now_ms);
        phase.phase_progress =
            compute_phase_progress(phase.phase_duration_seconds, phase.phase_out_time_seconds);
        phase.phase_eta_ms = compute_phase_eta_ms(
            phase.phase_duration_seconds,
            phase.phase_out_time_seconds,
            phase.phase_speed,
        );
        let phase = phase.clone();

        state.queue_delta_revision = state.queue_delta_revision.saturating_add(1);
        QueueStateLiteDelta {
            base_snapshot_revision: state.queue_snapshot_revision,
            delta_revision: state.queue_delta_revision,
            patches: vec![TranscodeJobLiteDeltaPatch {
                id: job_id.to_string(),
                status: None,
                processing_started_ms,
                progress: None,
                skip_reason: None,
                telemetry: Some(TranscodeJobLiteTelemetryDelta {
                    progress_epoch: None,
                    last_progress_out_time_seconds: None,
                    last_progress_speed: None,
                    last_progress_updated_at_ms: None,
                    last_progress_frame: None,
                    phase,
                }),
                elapsed_ms,
                preview: None,
            }],
        }
    };
    notify_queue_lite_delta_listeners(inner, delta);
}

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
        let mut heal_to_processing: Option<(String, String)> = None;
        if let Some(job) = state.jobs.get_mut(job_id) {
            let saw_progress_sample = progress_out_time_seconds.is_some()
                || progress_frame.is_some()
                || speed.is_some();
            if saw_progress_sample && matches!(job.status, JobStatus::Paused | JobStatus::Queued) {
                // These telemetry samples can only come from an actively running ffmpeg process.
                // If the job is still marked Paused/Queued, it means the runtime state got out
                // of sync (e.g. crash recovery/startup resume). Heal it immediately so the UI
                // never shows "paused" while output telemetry keeps advancing.
                job.status = JobStatus::Processing;
                if job.start_time.is_none() {
                    job.start_time = Some(now_ms);
                }
                if job.processing_started_ms.is_none() {
                    job.processing_started_ms = Some(now_ms);
                }
                heal_to_processing = Some((job.id.clone(), job.filename.clone()));
                telemetry_changed = true;
                should_notify = true;
            }

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

            if job.status == JobStatus::Processing
                && let Some(meta) = job.wait_metadata.as_mut()
            {
                if let Some(out_time) = progress_out_time_seconds
                    && out_time.is_finite()
                    && out_time >= 0.0
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
                        telemetry_changed = true;
                    }
                    // Even when the speed value itself is stable, refresh the
                    // timestamp so the frontend can keep extrapolating while
                    // ffmpeg is busy but out_time is temporarily stalled.
                    if meta.last_progress_updated_at_ms.is_none_or(|prev| prev != now_ms) {
                        meta.last_progress_updated_at_ms = Some(now_ms);
                        telemetry_changed = true;
                    }
                }

                if let Some(frame) = progress_frame
                {
                    let changed = meta
                        .last_progress_frame
                        .is_none_or(|prev| prev != frame);
                    if changed {
                        meta.last_progress_frame = Some(frame);
                        meta.last_progress_updated_at_ms = Some(now_ms);
                        telemetry_changed = true;
                    } else if meta.last_progress_updated_at_ms.is_none() {
                        meta.last_progress_updated_at_ms = Some(now_ms);
                        telemetry_changed = true;
                    }
                }
            }

            if let Some(p) = percent {
                // Progress percent is only meaningful while the job is actively processing.
                // When a job is Paused/Queued, the UI must never show "paused but still
                // advancing" due to stray/stale percent updates.
                if job.status == JobStatus::Processing {
                    let clamped = p.clamp(0.0, 100.0);
                    if clamped > job.progress {
                        job.progress = clamped;
                        progress_changed = true;
                        if let Some(meta) = job.wait_metadata.as_mut() {
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
                let telemetry = job.wait_metadata.as_ref().and_then(|m| {
                    let delta = TranscodeJobLiteTelemetryDelta {
                        progress_epoch: m.progress_epoch,
                        last_progress_out_time_seconds: m.last_progress_out_time_seconds,
                        last_progress_speed: m.last_progress_speed,
                        last_progress_updated_at_ms: m.last_progress_updated_at_ms,
                        last_progress_frame: m.last_progress_frame,
                        phase: ProgressPhaseTelemetry::default(),
                    };
                    if delta.progress_epoch.is_none()
                        && delta.last_progress_out_time_seconds.is_none()
                        && delta.last_progress_speed.is_none()
                        && delta.last_progress_updated_at_ms.is_none()
                        && delta.last_progress_frame.is_none()
                    {
                        None
                    } else {
                        Some(delta)
                    }
                });
                pending_patch = Some(TranscodeJobLiteDeltaPatch {
                    id: job.id.clone(),
                    status: Some(job.status),
                    processing_started_ms: job.processing_started_ms,
                    progress: progress_changed.then_some(job.progress),
                    skip_reason: job.skip_reason.clone(),
                    telemetry,
                    elapsed_ms: job.elapsed_ms,
                    preview: None,
                });
            }
        }

        if let Some((job_id_owned, filename)) = heal_to_processing {
            state.active_jobs.insert(job_id_owned.clone());
            state.active_inputs.insert(filename);
            state.queue.retain(|id| id != &job_id_owned);
            let preset_id = state.jobs.get(&job_id_owned).map(|job| job.preset_id.clone());
            if let Some(preset_id) = preset_id {
                state.note_preset_processing_started(&preset_id, now_ms);
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

    update_job_progress_phase_sample(inner, job_id, progress_out_time_seconds, speed);

    if should_persist_snapshot {
        persist_queue_state_lite_best_effort(inner);
    }
}
