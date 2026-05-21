#[cfg(test)]
mod batch_media_snapshot_tests {
    use super::*;
    use crate::ffui_core::domain::{
        ImageTargetFormat, JobSource, SavingConditionType, TranscodeJob,
    };
    use crate::ffui_core::engine::state::BatchCompressBatchStatus;

    fn restored_batch_media_job(
        job_id: &str,
        job_type: JobType,
        saving: BatchCompressSavingCondition,
    ) -> TranscodeJob {
        TranscodeJob {
            id: job_id.to_string(),
            filename: format!("C:/media/{job_id}.png"),
            job_type,
            source: JobSource::BatchCompress,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: Some("png".to_string()),
            preset_id: "audio-preset-1".to_string(),
            status: JobStatus::Queued,
            progress: 0.0,
            start_time: None,
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some(format!("C:/media/{job_id}.png")),
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
            batch_id: Some("restored-batch-without-runtime-meta".to_string()),
            batch_compress_saving_condition: Some(saving),
            wait_metadata: None,
        }
    }

    #[test]
    fn restored_batch_media_job_uses_persisted_media_config_without_batch_metadata() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "restored-image-child";
        {
            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(
                job_id.to_string(),
                restored_batch_media_job(
                    job_id,
                    JobType::Image,
                    BatchCompressSavingCondition {
                        saving_condition_type: SavingConditionType::AbsoluteSize,
                        min_saving_ratio: 0.88,
                        min_saving_absolute_mb: 42.0,
                        min_image_size_kb: Some(1234),
                        min_audio_size_kb: Some(5678),
                        image_target_format: Some(ImageTargetFormat::Webp),
                        replace_original: Some(true),
                    },
                ),
            );
        }

        let prepared = prepare_batch_compress_media_job(&inner, job_id)
            .expect("prepare should not error")
            .expect("restored media job should be prepared");

        assert_eq!(prepared.config.min_image_size_kb, 1234);
        assert_eq!(prepared.config.min_audio_size_kb, 5678);
        assert_eq!(prepared.config.image_target_format, ImageTargetFormat::Webp);
        assert!(prepared.config.replace_original);
        assert_eq!(
            prepared.config.saving_condition_type,
            SavingConditionType::AbsoluteSize
        );
        assert_eq!(prepared.config.min_saving_absolute_mb, 42.0);
    }

    #[test]
    fn restored_batch_media_job_without_complete_snapshot_is_failed() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "legacy-restored-image-child";
        {
            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(
                job_id.to_string(),
                restored_batch_media_job(
                    job_id,
                    JobType::Image,
                    BatchCompressSavingCondition {
                        saving_condition_type: SavingConditionType::Ratio,
                        min_saving_ratio: 0.95,
                        min_saving_absolute_mb: 5.0,
                        min_image_size_kb: None,
                        min_audio_size_kb: None,
                        image_target_format: None,
                        replace_original: None,
                    },
                ),
            );
        }

        process_batch_compress_media_job(&inner, job_id)
            .expect("incomplete legacy snapshot should be handled as a job failure");

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain in queue state");
        assert_eq!(job.status, JobStatus::Failed);
        let reason = job.failure_reason.clone().unwrap_or_default();
        assert!(
            reason.contains("missing complete persisted compression settings"),
            "failure reason should explain incomplete snapshot, got: {reason}"
        );
    }

    fn batch_media_result_job(job_id: &str, batch_id: &str, status: JobStatus) -> TranscodeJob {
        let mut job = restored_batch_media_job(
            job_id,
            JobType::Image,
            BatchCompressSavingCondition {
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                min_image_size_kb: Some(0),
                min_audio_size_kb: Some(0),
                image_target_format: Some(ImageTargetFormat::Webp),
                replace_original: Some(false),
            },
        );
        job.status = status;
        job.batch_id = Some(batch_id.to_string());
        job.progress = if status == JobStatus::Paused { 0.0 } else { 100.0 };
        job.end_time = (status != JobStatus::Paused).then(current_time_millis);
        job
    }

    fn insert_batch_for_media_result(inner: &Inner, job_id: &str, batch_id: &str) {
        let mut state = inner.state.lock_unpoisoned();
        state.batch_compress_batches.insert(
            batch_id.to_string(),
            BatchCompressBatch {
                batch_id: batch_id.to_string(),
                root_path: "C:/media".to_string(),
                replace_original: false,
                min_image_size_kb: 0,
                min_audio_size_kb: 0,
                image_target_format: ImageTargetFormat::Webp,
                output_policy: OutputPolicy::default(),
                saving_condition_type: SavingConditionType::Ratio,
                min_saving_ratio: 0.95,
                min_saving_absolute_mb: 5.0,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 0,
                child_job_ids: vec![job_id.to_string()],
                processed_child_job_ids: Default::default(),
                started_at_ms: current_time_millis(),
                completed_at_ms: None,
            },
        );
    }

    #[test]
    fn media_result_paused_by_wait_stays_paused_when_wait_request_remains() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "wait-still-pending-media-child";
        let batch_id = "batch-wait-still-pending-media-child";
        insert_batch_for_media_result(&inner, job_id, batch_id);
        {
            let mut state = inner.state.lock_unpoisoned();
            state.wait_requests.insert(job_id.to_string());
        }

        store_batch_compress_media_result(
            &inner,
            job_id,
            batch_media_result_job(job_id, batch_id, JobStatus::Paused),
        );
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should be stored");
        assert_eq!(job.status, JobStatus::Paused);
        assert!(state.queue.iter().any(|id| id == job_id));
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 0);
    }

    #[test]
    fn media_result_paused_by_wait_requeues_when_resume_cleared_wait_request() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "wait-resumed-media-child";
        let batch_id = "batch-wait-resumed-media-child";
        insert_batch_for_media_result(&inner, job_id, batch_id);

        store_batch_compress_media_result(
            &inner,
            job_id,
            batch_media_result_job(job_id, batch_id, JobStatus::Paused),
        );
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should be stored");
        assert_eq!(job.status, JobStatus::Queued);
        assert!(state.queue.iter().any(|id| id == job_id));
        assert!(!state.cancelled_jobs.contains(job_id));
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 0);
    }

    #[test]
    fn media_result_paused_by_wait_becomes_cancelled_when_cancel_request_arrives() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "wait-then-cancel-media-child";
        let batch_id = "batch-wait-then-cancel-media-child";
        insert_batch_for_media_result(&inner, job_id, batch_id);
        {
            let mut state = inner.state.lock_unpoisoned();
            state.cancelled_jobs.insert(job_id.to_string());
        }

        store_batch_compress_media_result(
            &inner,
            job_id,
            batch_media_result_job(job_id, batch_id, JobStatus::Paused),
        );
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should be stored");
        assert_eq!(job.status, JobStatus::Cancelled);
        assert!(!state.queue.iter().any(|id| id == job_id));
        assert!(!state.cancelled_jobs.contains(job_id));
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 1);
    }

    fn assert_late_cancel_preserves_terminal_media_result(status: JobStatus) {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = format!("late-cancel-preserves-{status:?}-media-child");
        let batch_id = format!("batch-late-cancel-preserves-{status:?}-media-child");
        insert_batch_for_media_result(&inner, &job_id, &batch_id);
        {
            let mut state = inner.state.lock_unpoisoned();
            state.cancelled_jobs.insert(job_id.clone());
            state.wait_requests.insert(job_id.clone());
        }

        let mut result = batch_media_result_job(&job_id, &batch_id, status);
        result.output_path = Some(format!("C:/media/{job_id}.compressed.webp"));
        result.output_size_mb = Some(0.5);
        if status == JobStatus::Failed {
            result.failure_reason = Some("encoder failure should remain visible".to_string());
        }
        if status == JobStatus::Skipped {
            result.skip_reason = Some("saving condition skip should remain visible".to_string());
        }

        store_batch_compress_media_result(&inner, &job_id, result);
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, &job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(&job_id).expect("job should be stored");
        assert_eq!(job.status, status);
        assert_eq!(job.progress, 100.0);
        assert!(job.end_time.is_some());
        assert_eq!(
            job.output_path.as_deref(),
            Some(format!("C:/media/{job_id}.compressed.webp").as_str())
        );
        assert_eq!(job.output_size_mb, Some(0.5));
        if status == JobStatus::Failed {
            assert_eq!(
                job.failure_reason.as_deref(),
                Some("encoder failure should remain visible")
            );
        }
        if status == JobStatus::Skipped {
            assert_eq!(
                job.skip_reason.as_deref(),
                Some("saving condition skip should remain visible")
            );
        }
        assert!(job.wait_metadata.is_none());
        assert!(!state.queue.iter().any(|id| id == &job_id));
        assert!(!state.cancelled_jobs.contains(&job_id));
        assert!(!state.wait_requests.contains(&job_id));
        let batch = state
            .batch_compress_batches
            .get(&batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 1);
    }

    #[test]
    fn late_cancel_preserves_completed_media_result() {
        assert_late_cancel_preserves_terminal_media_result(JobStatus::Completed);
    }

    #[test]
    fn late_cancel_preserves_skipped_media_result() {
        assert_late_cancel_preserves_terminal_media_result(JobStatus::Skipped);
    }

    #[test]
    fn late_cancel_preserves_failed_media_result() {
        assert_late_cancel_preserves_terminal_media_result(JobStatus::Failed);
    }

    #[test]
    fn media_result_completed_after_restart_request_keeps_finalized_output() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "restart-arrived-after-completed-media-child";
        let batch_id = "batch-restart-arrived-after-completed-media-child";
        insert_batch_for_media_result(&inner, job_id, batch_id);
        {
            let mut state = inner.state.lock_unpoisoned();
            state.cancelled_jobs.insert(job_id.to_string());
            state.restart_requests.insert(job_id.to_string());
            state.wait_requests.insert(job_id.to_string());
            state.queue.push_back(job_id.to_string());
        }

        let mut result = batch_media_result_job(job_id, batch_id, JobStatus::Completed);
        result.output_path = Some("C:/media/restart-arrived-after.completed.webp".to_string());
        result.output_size_mb = Some(0.25);
        result.preview_path = result.output_path.clone();
        result.preview_revision = 1;

        store_batch_compress_media_result(&inner, job_id, result);
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Completed);
        assert_eq!(job.progress, 100.0);
        assert!(job.end_time.is_some());
        assert_eq!(
            job.output_path.as_deref(),
            Some("C:/media/restart-arrived-after.completed.webp")
        );
        assert_eq!(job.output_size_mb, Some(0.25));
        assert_eq!(
            job.preview_path.as_deref(),
            Some("C:/media/restart-arrived-after.completed.webp")
        );
        assert_eq!(job.preview_revision, 1);
        assert!(
            job.logs.iter().any(|line| line.text.contains(
                "Restart request arrived after Batch Compress media child finalized"
            )),
            "job log should explain why the late restart was not requeued"
        );
        assert!(!state.queue.iter().any(|id| id == job_id));
        assert!(!state.cancelled_jobs.contains(job_id));
        assert!(!state.restart_requests.contains(job_id));
        assert!(!state.wait_requests.contains(job_id));
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 1);
        assert_eq!(batch.status, BatchCompressBatchStatus::Completed);
    }

    #[test]
    fn media_error_after_cancel_request_marks_child_cancelled() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "cancel-then-media-error-child";
        let batch_id = "batch-cancel-then-media-error-child";
        insert_batch_for_media_result(&inner, job_id, batch_id);
        {
            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(
                job_id.to_string(),
                batch_media_result_job(job_id, batch_id, JobStatus::Processing),
            );
            state.cancelled_jobs.insert(job_id.to_string());
        }

        mark_batch_compress_media_failed(
            &inner,
            job_id,
            anyhow::anyhow!("encoder cleanup failed after cancel"),
        );
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Cancelled);
        assert_eq!(job.progress, 0.0);
        assert!(job.failure_reason.is_none());
        assert!(!state.cancelled_jobs.contains(job_id));
        assert!(!state.restart_requests.contains(job_id));
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 1);
    }

    #[test]
    fn media_error_after_restart_request_requeues_child() {
        let inner = Inner::new(vec![], AppSettings::default());
        let job_id = "restart-then-media-error-child";
        let batch_id = "batch-restart-then-media-error-child";
        insert_batch_for_media_result(&inner, job_id, batch_id);
        {
            let mut state = inner.state.lock_unpoisoned();
            state.jobs.insert(
                job_id.to_string(),
                batch_media_result_job(job_id, batch_id, JobStatus::Processing),
            );
            state.cancelled_jobs.insert(job_id.to_string());
            state.restart_requests.insert(job_id.to_string());
        }

        mark_batch_compress_media_failed(
            &inner,
            job_id,
            anyhow::anyhow!("encoder failed after restart cancellation"),
        );
        super::super::worker_utils::mark_batch_compress_child_processed(&inner, job_id);

        let state = inner.state.lock_unpoisoned();
        let job = state.jobs.get(job_id).expect("job should remain");
        assert_eq!(job.status, JobStatus::Queued);
        assert_eq!(job.progress, 0.0);
        assert!(job.failure_reason.is_none());
        assert!(state.queue.iter().any(|id| id == job_id));
        assert!(!state.cancelled_jobs.contains(job_id));
        assert!(!state.restart_requests.contains(job_id));
        let batch = state
            .batch_compress_batches
            .get(batch_id)
            .expect("batch should remain");
        assert_eq!(batch.total_processed, 0);
    }
}
