use std::sync::Arc;

use crate::ffui_core::domain::JobStatus;
use crate::ffui_core::engine::state::restore_segment_probe::{
    SegmentDirCache, build_segment_probe_for_job, recover_wait_metadata_from_filesystem,
    wait_metadata_has_no_usable_paths,
};
use crate::sync_ext::MutexExt;

use super::super::state::Inner;

pub(in crate::ffui_core::engine) fn probe_crash_recovery_wait_metadata_for_processing_job_best_effort(
    inner: &Arc<Inner>,
    job_id: &str,
    cache: &mut SegmentDirCache,
) -> bool {
    let (probe, had_resume_evidence, existing_wait_metadata) = {
        let state = inner.state.lock_unpoisoned();
        let Some(job) = state.jobs.get(job_id) else {
            return false;
        };
        if job.status != JobStatus::Processing {
            return false;
        }
        let existing_wait_metadata = job.wait_metadata.clone();
        let had_resume_evidence = job.elapsed_ms.is_some_and(|ms| ms > 0)
            || existing_wait_metadata
                .as_ref()
                .and_then(|m| m.last_progress_percent)
                .is_some_and(|p| p.is_finite() && p > 0.0)
            || existing_wait_metadata
                .as_ref()
                .and_then(|m| m.processed_wall_millis)
                .is_some_and(|ms| ms > 0);
        let probe = build_segment_probe_for_job(job);
        (probe, had_resume_evidence, existing_wait_metadata)
    };

    if !had_resume_evidence {
        return false;
    }

    let existing_has_no_usable_paths = existing_wait_metadata
        .as_ref()
        .is_some_and(wait_metadata_has_no_usable_paths);
    let should_apply_recovered = existing_wait_metadata.is_none() || existing_has_no_usable_paths;
    if !should_apply_recovered {
        return false;
    }

    let Some(meta) = recover_wait_metadata_from_filesystem(&probe, cache) else {
        // If we have persisted resume metadata but none of it exists on disk,
        // treat this run as a fresh encode attempt so progress updates from
        // ffmpeg are not suppressed by the monotonic progress guard.
        //
        // This can happen when users clean temp folders or move the output dir
        // between sessions. Keeping stale paths would otherwise "freeze" the
        // UI at the old progress until the new run surpasses it, which looks
        // like sudden jumps or instant completion.
        if !existing_has_no_usable_paths {
            return false;
        }

        let mut state = inner.state.lock_unpoisoned();
        let Some(job) = state.jobs.get_mut(job_id) else {
            return false;
        };
        if job.status != JobStatus::Processing {
            return false;
        }
        if let Some(meta) = job.wait_metadata.as_mut()
            && wait_metadata_has_no_usable_paths(meta)
        {
            meta.last_progress_percent = None;
            meta.processed_seconds = None;
            meta.target_seconds = None;
            meta.last_progress_out_time_seconds = None;
            meta.last_progress_frame = None;
            meta.tmp_output_path = None;
            meta.segments = None;
            meta.segment_end_targets = None;
        }
        job.progress = 0.0;
        return true;
    };

    let mut state = inner.state.lock_unpoisoned();
    let Some(job) = state.jobs.get_mut(job_id) else {
        return false;
    };
    if job.status != JobStatus::Processing {
        return false;
    }
    if !should_apply_recovered {
        return false;
    }

    let recovered_progress = meta
        .last_progress_percent
        .filter(|p| p.is_finite() && *p > 0.0 && *p <= 100.0);
    job.wait_metadata = Some(meta);
    if let Some(p) = recovered_progress
        && job.progress.is_finite()
        && p > job.progress
    {
        job.progress = p;
    }
    true
}
