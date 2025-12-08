use std::collections::HashSet;
use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;

use crate::ffui_core::domain::{JobSource, JobStatus, JobType, MediaInfo, TranscodeJob};

use super::state::{EngineState, Inner, notify_queue_listeners};

use super::worker_utils::{
    build_video_output_path, current_time_millis, estimate_job_seconds_for_preset,
    mark_smart_scan_child_processed, recompute_log_tail,
};

/// Spawn worker threads that process jobs from the queue.
///
/// Determines a bounded worker count based on available logical cores
/// and, when configured, the user-specified concurrency limit. This
/// keeps behaviour predictable while still letting power users cap
/// resource usage explicitly from the settings panel.
pub(super) fn spawn_worker(inner: Arc<Inner>) {
    let logical_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .max(1);

    let configured_max = {
        let state = inner.state.lock().expect("engine state poisoned");
        state.settings.max_parallel_jobs.unwrap_or(0)
    };

    let auto_workers = if logical_cores >= 4 {
        std::cmp::max(2, logical_cores / 2)
    } else {
        1
    };

    let worker_count = if configured_max == 0 {
        auto_workers
    } else {
        let max = configured_max as usize;
        // Clamp into [1, logical_cores] so we never oversubscribe the CPU.
        max.clamp(1, logical_cores)
    };

    for index in 0..worker_count {
        let inner_clone = inner.clone();
        thread::Builder::new()
            .name(format!("ffui-transcode-worker-{index}"))
            .spawn(move || worker_loop(inner_clone))
            .expect("failed to spawn transcoding worker thread");
    }
}

/// Pop the next job id from the queue and mark it as processing under the
/// engine state lock. This helper is used both by the real worker threads and
/// by tests that need to reason about multi-worker scheduling behaviour.
pub(super) fn next_job_for_worker_locked(state: &mut EngineState) -> Option<String> {
    let job_id = state.queue.pop_front()?;
    state.active_job = Some(job_id.clone());

    if let Some(job) = state.jobs.get_mut(&job_id) {
        job.status = JobStatus::Processing;
        if job.start_time.is_none() {
            job.start_time = Some(current_time_millis());
        }
        // For fresh jobs we start from 0%, but for resumed jobs that already
        // have meaningful progress and wait metadata we keep the existing
        // percentage so the UI does not jump backwards when continuing from
        // a partial output segment.
        if job.progress <= 0.0 || job.wait_metadata.is_none() || !job.progress.is_finite() {
            job.progress = 0.0;
        }
    }

    Some(job_id)
}

/// Worker thread main loop.
///
/// Continuously waits for jobs in the queue, processes them, and updates
/// their status. Handles cooperative cancellation and error reporting.
fn worker_loop(inner: Arc<Inner>) {
    loop {
        let job_id = {
            let mut state = inner.state.lock().expect("engine state poisoned");
            while state.queue.is_empty() {
                state = inner.cv.wait(state).expect("engine state poisoned");
            }

            match next_job_for_worker_locked(&mut state) {
                Some(id) => id,
                None => continue,
            }
        };

        // Notify listeners that a job has moved into processing state.
        notify_queue_listeners(&inner);

        // Call the job runner to process the transcode job
        if let Err(err) = super::job_runner::process_transcode_job(&inner, &job_id) {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(&job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("Transcode failed: {err:#}");
                    job.failure_reason = Some(reason.clone());
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            mark_smart_scan_child_processed(&inner, &job_id);
        }

        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            state.active_job = None;
            state.cancelled_jobs.remove(&job_id);
        }

        // Broadcast final state for the completed / failed / skipped job.
        notify_queue_listeners(&inner);
    }
}

/// Enqueue a new transcode job with the specified parameters.
///
/// Creates a new job, assigns it a unique ID, computes metadata, and adds it
/// to the waiting queue. Returns the created job.
pub(super) fn enqueue_transcode_job(
    inner: &Arc<Inner>,
    filename: String,
    job_type: JobType,
    source: JobSource,
    original_size_mb: f64,
    original_codec: Option<String>,
    preset_id: String,
) -> TranscodeJob {
    let id = {
        let next_id = inner.next_job_id.fetch_add(1, Ordering::SeqCst);
        format!("job-{next_id}")
    };

    let now_ms = current_time_millis();

    let input_path = filename.clone();

    // Prefer a backend-derived size based on the actual file on disk; fall back
    // to the caller-provided value if metadata is unavailable.
    let computed_original_size_mb = fs::metadata(&filename)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(original_size_mb);

    let output_path = if matches!(job_type, JobType::Video) {
        let path = PathBuf::from(&filename);
        Some(
            build_video_output_path(&path)
                .to_string_lossy()
                .into_owned(),
        )
    } else {
        None
    };

    let codec_for_job = original_codec.clone();

    let job = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let estimated_seconds = state
            .presets
            .iter()
            .find(|p| p.id == preset_id)
            .and_then(|p| estimate_job_seconds_for_preset(computed_original_size_mb, p));
        let job = TranscodeJob {
            id: id.clone(),
            filename,
            job_type,
            source,
            queue_order: None,
            original_size_mb: computed_original_size_mb,
            original_codec: codec_for_job,
            preset_id,
            status: JobStatus::Waiting,
            progress: 0.0,
            start_time: Some(now_ms),
            end_time: None,
            output_size_mb: None,
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some(input_path),
            output_path,
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: None,
                width: None,
                height: None,
                frame_rate: None,
                video_codec: original_codec,
                audio_codec: None,
                size_mb: Some(computed_original_size_mb),
            }),
            estimated_seconds,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: None,
            wait_metadata: None,
        };
        state.queue.push_back(id.clone());
        state.jobs.insert(id.clone(), job.clone());
        job
    };
    inner.cv.notify_one();
    notify_queue_listeners(inner);
    job
}

/// Cancel a job by ID.
///
/// If the job is waiting/queued, removes it from the queue and marks as cancelled.
/// If the job is processing, marks it for cooperative cancellation by the worker.
/// Returns true if the job was successfully cancelled or marked for cancellation.
pub(super) fn cancel_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status.clone(),
            None => return false,
        };

        match status {
            JobStatus::Waiting | JobStatus::Queued => {
                // Remove from queue and mark as cancelled without ever starting ffmpeg.
                state.queue.retain(|id| id != job_id);
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Cancelled;
                    job.progress = 0.0;
                    job.end_time = Some(current_time_millis());
                    job.logs.push("Cancelled before start".to_string());
                    recompute_log_tail(job);
                }
                should_notify = true;
                true
            }
            JobStatus::Processing => {
                // Mark for cooperative cancellation; the worker thread will
                // observe this and terminate the underlying ffmpeg process.
                state.cancelled_jobs.insert(job_id.to_string());
                should_notify = true;
                true
            }
            _ => false,
        }
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    result
}

/// Request that a running job transition into a "wait" state, releasing
/// its worker slot while preserving progress. The actual state change is
/// performed cooperatively inside the worker loop.
pub(super) fn wait_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let status = match state.jobs.get(job_id) {
            Some(job) => job.status.clone(),
            None => return false,
        };

        match status {
            JobStatus::Processing => {
                state.wait_requests.insert(job_id.to_string());
                should_notify = true;
                true
            }
            _ => false,
        }
    };

    if should_notify {
        notify_queue_listeners(inner);
    }

    result
}

/// Resume a previously paused (waited) job by placing it back into the
/// waiting queue. The job keeps its existing progress and wait metadata.
pub(super) fn resume_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get_mut(job_id) {
            Some(job) => job,
            None => return false,
        };

        match job.status {
            JobStatus::Paused => {
                job.status = JobStatus::Waiting;
                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }
                should_notify = true;
                true
            }
            _ => false,
        }
    };

    if should_notify {
        inner.cv.notify_one();
        notify_queue_listeners(inner);
    }

    result
}

/// Restart a job from 0% progress. For jobs that are currently processing
/// this schedules a cooperative cancellation followed by a fresh enqueue
/// in `mark_job_cancelled`. For non-processing jobs the state is reset
/// immediately and the job is reinserted into the waiting queue.
pub(super) fn restart_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    let mut should_notify = false;

    let result = {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get_mut(job_id) {
            Some(job) => job,
            None => return false,
        };

        match job.status {
            JobStatus::Completed | JobStatus::Skipped => false,
            JobStatus::Processing => {
                state.restart_requests.insert(job_id.to_string());
                state.cancelled_jobs.insert(job_id.to_string());
                should_notify = true;
                true
            }
            _ => {
                // Reset immediately for non-processing jobs.
                job.status = JobStatus::Waiting;
                job.progress = 0.0;
                job.end_time = None;
                job.failure_reason = None;
                job.skip_reason = None;
                job.wait_metadata = None;
                job.logs
                    .push("Restart requested from UI; job will re-run from 0%".to_string());
                recompute_log_tail(job);

                if !state.queue.iter().any(|id| id == job_id) {
                    state.queue.push_back(job_id.to_string());
                }

                should_notify = true;
                // Any old restart or cancel flags become irrelevant.
                state.restart_requests.remove(job_id);
                state.cancelled_jobs.remove(job_id);
                true
            }
        }
    };

    if should_notify {
        inner.cv.notify_one();
        notify_queue_listeners(inner);
    }

    result
}

/// Permanently delete a job from the engine state.
///
/// Only terminal-state jobs (Completed/Failed/Skipped/Cancelled) are eligible
/// for deletion. Active or waiting jobs are kept to avoid silently losing
/// work that is still running or scheduled.
pub(super) fn delete_job(inner: &Arc<Inner>, job_id: &str) -> bool {
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(j) => j.clone(),
            None => return false,
        };

        match job.status {
            JobStatus::Completed
            | JobStatus::Failed
            | JobStatus::Skipped
            | JobStatus::Cancelled => {
                // Guard against deleting the currently active job even if the
                // status somehow appears terminal; this should not normally
                // happen but keeps the behaviour defensive.
                if state.active_job.as_deref() == Some(job_id) {
                    return false;
                }

                // Remove from waiting queue and book-keeping sets.
                state.queue.retain(|id| id != job_id);
                state.cancelled_jobs.remove(job_id);
                state.wait_requests.remove(job_id);
                state.restart_requests.remove(job_id);

                // Finally drop the job record.
                state.jobs.remove(job_id);
            }
            _ => {
                // Non-terminal jobs cannot be deleted directly.
                return false;
            }
        }
    }

    notify_queue_listeners(inner);
    true
}

/// Reorder the waiting queue according to the provided ordered job ids.
/// Job ids not present in `ordered_ids` keep their relative order at the
/// tail of the queue so the operation is resilient to partial payloads.
pub(super) fn reorder_waiting_jobs(inner: &Arc<Inner>, ordered_ids: Vec<String>) -> bool {
    let mut should_notify = false;

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if state.queue.is_empty() || ordered_ids.is_empty() {
            return false;
        }

        let ordered_set: HashSet<String> = ordered_ids.iter().cloned().collect();

        // Preserve any ids that are currently in the queue but not covered
        // by the payload so we never "lose" jobs due to a truncated list.
        let mut remaining: VecDeque<String> = state
            .queue
            .iter()
            .filter(|id| !ordered_set.contains(*id))
            .cloned()
            .collect();

        let mut next_queue: VecDeque<String> = VecDeque::new();

        for id in ordered_ids {
            if state.jobs.contains_key(&id)
                && state.queue.contains(&id)
                && !next_queue.contains(&id)
            {
                next_queue.push_back(id.clone());
            }
        }

        // Append any remaining jobs that were not explicitly reordered.
        while let Some(id) = remaining.pop_front() {
            if !next_queue.contains(&id) {
                next_queue.push_back(id);
            }
        }

        if next_queue != state.queue {
            state.queue = next_queue;
            should_notify = true;
        }
    }

    if should_notify {
        notify_queue_listeners(inner);
    }

    should_notify
}
