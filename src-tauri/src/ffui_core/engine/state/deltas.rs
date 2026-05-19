use crate::ffui_core::domain::{
    JobStatus, QueueStateLiteDelta, TranscodeJobLiteDeltaPatch, TranscodeJobLiteTelemetryDelta,
};
use crate::sync_ext::MutexExt;

use super::{Inner, notify_queue_lite_delta_listeners};

pub(in crate::ffui_core::engine) fn notify_queue_lite_delta_for_job_terminal_state(
    inner: &Inner,
    job_id: &str,
) {
    let delta = {
        let mut state = inner.state.lock_unpoisoned();
        let Some(job) = state.jobs.get(job_id) else {
            return;
        };
        if !matches!(
            job.status,
            JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
        ) {
            return;
        }

        let base_snapshot_revision = state.queue_snapshot_revision;
        let telemetry = state
            .progress_phase_by_job
            .get(job_id)
            .cloned()
            .map(|phase| TranscodeJobLiteTelemetryDelta {
                progress_epoch: None,
                last_progress_out_time_seconds: None,
                last_progress_speed: None,
                last_progress_updated_at_ms: None,
                last_progress_frame: None,
                phase,
            });
        let patch = TranscodeJobLiteDeltaPatch {
            id: job.id.clone(),
            status: Some(job.status),
            processing_started_ms: job.processing_started_ms,
            progress: Some(job.progress),
            skip_reason: job.skip_reason.clone(),
            telemetry,
            elapsed_ms: job.elapsed_ms,
            preview: None,
        };

        state.queue_delta_revision = state.queue_delta_revision.saturating_add(1);
        QueueStateLiteDelta {
            base_snapshot_revision,
            delta_revision: state.queue_delta_revision,
            patches: vec![patch],
        }
    };

    notify_queue_lite_delta_listeners(inner, delta);
}
