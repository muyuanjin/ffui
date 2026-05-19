fn batch_compress_video_saving_condition(
    inner: &Inner,
    job_id: &str,
) -> Option<super::batch_compress::SavingConditionConfig> {
    let state = inner.state.lock_unpoisoned();
    state.jobs.get(job_id).and_then(|job| {
        if !matches!(job.source, JobSource::BatchCompress) || !matches!(job.job_type, JobType::Video) {
            return None;
        }
        if let Some(condition) = job.batch_compress_saving_condition {
            return Some(super::batch_compress::SavingConditionConfig {
                saving_condition_type: condition.saving_condition_type,
                min_saving_ratio: condition.min_saving_ratio,
                min_saving_absolute_mb: condition.min_saving_absolute_mb,
            });
        }
        let batch_id = job.batch_id.as_ref()?;
        let batch = state.batch_compress_batches.get(batch_id)?;
        Some(super::batch_compress::SavingConditionConfig {
            saving_condition_type: batch.saving_condition_type,
            min_saving_ratio: batch.min_saving_ratio,
            min_saving_absolute_mb: batch.min_saving_absolute_mb,
        })
    })
}

fn skip_batch_video_low_savings(
    inner: &Inner,
    job_id: &str,
    candidate_output: &Path,
    original_size_bytes: u64,
    new_size_bytes: u64,
) -> bool {
    let Some(condition) = batch_compress_video_saving_condition(inner, job_id) else {
        return false;
    };

    if super::batch_compress::saving_condition_allows_output(
        condition,
        original_size_bytes,
        new_size_bytes,
    ) {
        return false;
    }

    let mut state = inner.state.lock_unpoisoned();
    if let Some(job) = state.jobs.get_mut(job_id) {
        super::batch_compress::mark_job_skipped_by_saving_condition(
            job,
            candidate_output,
            condition,
            original_size_bytes,
            new_size_bytes,
        );
    } else {
        drop(fs::remove_file(candidate_output));
    }
    drop(state);
    set_job_progress_phase(inner, job_id, ProgressPhase::Completed, None);
    super::state::notify_queue_lite_delta_for_job_terminal_state(inner, job_id);
    mark_batch_compress_child_processed(inner, job_id);
    true
}

#[cfg(test)]
mod batch_compress_video_savings_tests {
    use super::*;
    use crate::ffui_core::domain::{
        BatchCompressSavingCondition, OutputPolicy, ProgressPhase, SavingConditionType,
        TranscodeJob,
    };
    use crate::ffui_core::engine::state::{
        BatchCompressBatch, BatchCompressBatchStatus, reset_snapshot_queue_state_calls,
        snapshot_queue_state_calls,
    };
    use crate::ffui_core::settings::AppSettings;

    fn batch_video_job(job_id: &str, batch_id: &str) -> TranscodeJob {
        TranscodeJob {
            id: job_id.to_string(),
            filename: "video.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::BatchCompress,
            queue_order: None,
            original_size_mb: 100.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Processing,
            progress: 50.0,
            start_time: Some(1),
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some("input.mp4".to_string()),
            created_time_ms: None,
            modified_time_ms: None,
            output_path: None,
            output_policy: Some(OutputPolicy::default()),
            ffmpeg_command: None,
            runs: Vec::new(),
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: Some(batch_id.to_string()),
            batch_compress_saving_condition: None,
            wait_metadata: None,
        }
    }

    fn make_inner_with_batch_video_job(
        batch_id: &str,
        job_id: &str,
        root_path: &Path,
    ) -> Inner {
        let inner = Inner::new(vec![], AppSettings::default());
        let mut state = inner.state.lock_unpoisoned();
        let total_candidates = 1;
        state.batch_compress_batches.insert(
            batch_id.to_string(),
            BatchCompressBatch {
                batch_id: batch_id.to_string(),
                root_path: root_path.to_string_lossy().into_owned(),
                replace_original: false,
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 1,
                total_candidates,
                total_processed: 0,
                child_job_ids: vec![job_id.to_string()],
                started_at_ms: 1,
                completed_at_ms: None,
            },
        );
        state
            .jobs
            .insert(job_id.to_string(), batch_video_job(job_id, batch_id));
        drop(state);
        inner
    }

    #[test]
    fn low_savings_gate_removes_finalized_batch_compress_video_candidate() {
        let dir = tempfile::tempdir().expect("tempdir");
        let output = dir.path().join("resumed-output.mp4");
        fs::write(&output, vec![0u8; 96]).expect("write finalized candidate output");

        let batch_id = "batch-resume-low-savings";
        let job_id = "job-resume-low-savings";
        let inner = make_inner_with_batch_video_job(batch_id, job_id, dir.path());

        assert!(
            skip_batch_video_low_savings(&inner, job_id, &output, 100, 96),
            "candidate should be skipped when resumed output fails the savings gate"
        );
        assert!(
            !output.exists(),
            "low-savings finalized candidate output should be removed"
        );

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Skipped);
        assert!(
            job.skip_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("Low savings")),
            "skip reason should explain the saving condition failure"
        );
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 1);
        assert_eq!(batch.status, BatchCompressBatchStatus::Completed);
    }

    #[test]
    fn low_savings_gate_emits_terminal_queue_lite_delta_before_batch_completion_refresh() {
        let dir = tempfile::tempdir().expect("tempdir");
        let output = dir.path().join("resumed-output.mp4");
        fs::write(&output, vec![0u8; 96]).expect("write low-savings candidate output");

        let batch_id = "batch-low-savings-terminal-delta";
        let job_id = "job-low-savings-terminal-delta";
        let inner = make_inner_with_batch_video_job(batch_id, job_id, dir.path());
        {
            let mut state = inner.state.lock_unpoisoned();
            let batch = state
                .batch_compress_batches
                .get_mut(batch_id)
                .expect("batch should exist");
            batch.total_candidates = 2;
            batch.child_job_ids.push("pending-job".to_string());
        }

        let deltas = capture_queue_lite_deltas_for_tests(&inner);
        reset_snapshot_queue_state_calls();

        assert!(
            skip_batch_video_low_savings(&inner, job_id, &output, 100, 96),
            "candidate should be skipped when it fails the savings gate"
        );

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Skipped);
        assert_eq!(job.progress, 100.0);
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 1);
        assert_eq!(batch.status, BatchCompressBatchStatus::Running);
        drop(state);

        assert_eq!(
            snapshot_queue_state_calls(),
            0,
            "unfinished batch child skip should not trigger a full queue refresh"
        );

        let deltas = deltas.lock_unpoisoned();
        let terminal_delta = deltas
            .iter()
            .find(|delta| {
                delta.patches.iter().any(|patch| {
                    patch.id == job_id
                        && patch.status == Some(JobStatus::Skipped)
                        && patch.progress == Some(100.0)
                })
            })
            .expect("low-savings skip should emit a terminal queue-lite delta");
        let patch = terminal_delta
            .patches
            .iter()
            .find(|patch| patch.id == job_id)
            .expect("terminal delta should include skipped job");
        assert!(
            patch
                .skip_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("Low savings")),
            "terminal skipped delta should include the low-savings skip reason"
        );
        assert_eq!(
            patch
                .telemetry
                .as_ref()
                .and_then(|telemetry| telemetry.phase.progress_phase),
            Some(ProgressPhase::Completed)
        );
    }

    #[test]
    fn low_savings_gate_leaves_candidate_when_batch_video_saves_enough() {
        let dir = tempfile::tempdir().expect("tempdir");
        let output = dir.path().join("resumed-output.mp4");
        fs::write(&output, vec![0u8; 94]).expect("write finalized candidate output");

        let batch_id = "batch-resume-good-savings";
        let job_id = "job-resume-good-savings";
        let inner = make_inner_with_batch_video_job(batch_id, job_id, dir.path());

        assert!(
            !skip_batch_video_low_savings(&inner, job_id, &output, 100, 94),
            "candidate should continue when output satisfies the savings gate"
        );
        assert!(
            output.exists(),
            "accepted finalized candidate output should remain"
        );

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Processing);
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 0);
    }

    #[test]
    fn low_savings_gate_uses_restored_job_saving_condition_without_batch_metadata() {
        let dir = tempfile::tempdir().expect("tempdir");
        let output = dir.path().join("restored-output.mp4");
        fs::write(&output, vec![0u8; 96]).expect("write restored candidate output");

        let batch_id = "restored-batch-without-runtime-meta";
        let job_id = "restored-job-with-snapshot-condition";
        let inner = Inner::new(vec![], AppSettings::default());
        {
            let mut state = inner.state.lock_unpoisoned();
            let mut job = batch_video_job(job_id, batch_id);
            job.batch_compress_saving_condition = Some(BatchCompressSavingCondition {
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
            });
            state.jobs.insert(job_id.to_string(), job);
        }

        assert!(
            skip_batch_video_low_savings(&inner, job_id, &output, 100, 96),
            "restored Batch Compress job should still apply its persisted savings gate"
        );
        assert!(
            !output.exists(),
            "restored low-savings candidate output should be removed"
        );

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Skipped);
        assert!(
            job.skip_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("Low savings")),
            "skip reason should explain the saving condition failure"
        );
        assert!(
            !state.batch_compress_batches.contains_key(batch_id),
            "test intentionally simulates restored jobs without runtime batch metadata"
        );
    }
}
