use crate::ffui_core::domain::{JobType, QueueStateLite, TranscodeJobLite};

use super::{EngineState, build_queue_order_map, sort_jobs_by_queue_order_and_id};

pub(super) fn snapshot_queue_state_lite_from_locked_state(
    state: &mut EngineState,
) -> QueueStateLite {
    let snapshot_revision = state.queue_snapshot_revision;
    let order_by_id = build_queue_order_map(state);

    let mut jobs: Vec<TranscodeJobLite> = Vec::with_capacity(state.jobs.len());
    for (id, job) in &state.jobs {
        let mut lite = TranscodeJobLite::from(job);
        if lite.job_type == JobType::Video
            && let Some(input_path) = job.input_path.as_deref()
            && let Some(expected) = super::super::job_runner::expected_preview_output_path_for_video(
                std::path::Path::new(input_path),
                state.settings.preview_capture_percent,
            )
        {
            let expected_str = expected.to_string_lossy();
            if lite.preview_path.as_deref() != Some(expected_str.as_ref()) {
                // Mark legacy previews as missing so the frontend triggers
                // ensure_job_preview lazily while scrolling.
                lite.preview_path = None;
            }
        }
        lite.queue_order = order_by_id.get(id.as_str()).copied();
        jobs.push(lite);
    }

    sort_jobs_by_queue_order_and_id(&mut jobs);

    QueueStateLite {
        snapshot_revision,
        jobs,
    }
}
