// ============================================================================
// Job state queries
// ============================================================================

pub(super) fn is_job_cancelled(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock().expect("engine state poisoned");
    state.cancelled_jobs.contains(job_id)
}

pub(super) fn is_job_wait_requested(inner: &Inner, job_id: &str) -> bool {
    let state = inner.state.lock().expect("engine state poisoned");
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
) -> Result<()> {
    let tmp_str = tmp_output.to_string_lossy().into_owned();
    let output_str = output_path.to_string_lossy().into_owned();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.status = JobStatus::Paused;

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

            let processed_seconds = match (percent, media_duration) {
                (Some(p), Some(total))
                    if p.is_finite() && total.is_finite() && p > 0.0 && total > 0.0 =>
                {
                    Some((p / 100.0) * total)
                }
                _ => None,
            };

            job.wait_metadata = Some(WaitMetadata {
                last_progress_percent: percent,
                processed_seconds,
                tmp_output_path: Some(tmp_str.clone()),
            });

            if job.output_path.is_none() {
                job.output_path = Some(output_str.clone());
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
    mark_smart_scan_child_processed(inner, job_id);
    Ok(())
}

pub(super) fn mark_job_cancelled(inner: &Inner, job_id: &str) -> Result<()> {
    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let restart_after_cancel = state.restart_requests.remove(job_id);

        if let Some(job) = state.jobs.get_mut(job_id) {
            if restart_after_cancel {
                // Reset the job back to Waiting with 0% progress and enqueue
                // it for a fresh run from the beginning.
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
            } else {
                job.status = JobStatus::Cancelled;
                job.progress = 0.0;
                job.end_time = Some(current_time_millis());
                job.logs.push("Cancelled by user".to_string());
                recompute_log_tail(job);
            }
        }

        state.cancelled_jobs.remove(job_id);
    }

    // Notify listeners that the job has transitioned to Cancelled or has been
    // reset for a fresh restart.
    notify_queue_listeners(inner);
    // Wake at least one worker in case a restart enqueued a new job.
    inner.cv.notify_one();
    mark_smart_scan_child_processed(inner, job_id);
    Ok(())
}
