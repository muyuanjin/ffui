use super::*;

#[test]
fn delete_job_only_allows_terminal_statuses() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );
    let engine = TranscodingEngine::new().expect("failed to create engine");

    // Enqueue a waiting job.
    let job_waiting = engine.enqueue_transcode_job(
        "C:/videos/waiting.mp4".to_string(),
        JobType::Video,
        JobSource::Manual,
        10.0,
        Some("h264".to_string()),
        "preset-1".to_string(),
    );

    // Simulate a completed job by cloning and inserting into state directly.
    let completed_id = "job-completed-delete-test".to_string();
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        let mut completed = job_waiting.clone();
        completed.id = completed_id.clone();
        completed.status = JobStatus::Completed;
        completed.progress = 100.0;
        state.jobs.insert(completed_id.clone(), completed);
    }

    // Deleting a non-terminal job must fail and keep it in the snapshot.
    assert!(
        !engine.delete_job(&job_waiting.id),
        "non-terminal job should not be deletable",
    );
    let snapshot = engine.queue_state();
    assert!(
        snapshot.jobs.iter().any(|j| j.id == job_waiting.id),
        "waiting job must remain present after failed delete",
    );

    // Deleting a completed job must succeed and remove it from the snapshot.
    assert!(
        engine.delete_job(&completed_id),
        "completed job should be deletable",
    );
    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after.jobs.iter().any(|j| j.id == completed_id),
        "completed job must be removed from queue state after delete",
    );
}

#[test]
fn delete_batch_compress_child_job_is_deletable() {
    let engine = make_engine_with_preset();

    let batch_id = "batch-compress-batch-delete-test".to_string();
    let job_id = "batch-compress-job-delete-test".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        // 为该批次注册一个简单的 Batch Compress 批次记录，模拟真实运行环境中的批次元数据。
        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: BatchCompressBatchStatus::Completed,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 1,
                child_job_ids: vec![job_id.clone()],
                started_at_ms: 0,
                completed_at_ms: Some(0),
            },
        );

        // 插入一个属于该 Batch Compress 批次、已完成状态的子任务。
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/input.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::BatchCompress,
                queue_order: None,
                original_size_mb: 10.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Completed,
                progress: 100.0,
                start_time: Some(current_time_millis()),
                end_time: Some(current_time_millis()),
                processing_started_ms: None,
                elapsed_ms: None,
                output_size_mb: Some(5.0),
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: Some("C:/videos/input.mp4".to_string()),
                output_path: Some("C:/videos/input.compressed.mp4".to_string()),
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                preview_revision: 0,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: Some(batch_id),
                wait_metadata: None,
            },
        );
    }

    // Batch Compress 的子任务同样应该可以被 delete_job 删除，并从队列快照中消失。
    assert!(
        engine.delete_job(&job_id),
        "Batch Compress child job in terminal state should be deletable",
    );

    let snapshot = engine.queue_state();
    assert!(
        !snapshot.jobs.iter().any(|j| j.id == job_id),
        "Batch Compress child job must be removed from queue state after delete",
    );
}

#[test]
fn delete_batch_compress_non_terminal_job_is_rejected() {
    let engine = make_engine_with_preset();

    let batch_id = "batch-compress-batch-reject-test".to_string();
    let job_id = "batch-compress-job-reject-test".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 0,
                child_job_ids: vec![job_id.clone()],
                started_at_ms: current_time_millis(),
                completed_at_ms: None,
            },
        );

        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/input.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::BatchCompress,
                queue_order: None,
                original_size_mb: 10.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status: JobStatus::Processing,
                progress: 50.0,
                start_time: Some(current_time_millis()),
                end_time: None,
                processing_started_ms: None,
                elapsed_ms: None,
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: Some("C:/videos/input.mp4".to_string()),
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                preview_revision: 0,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: Some(batch_id),
                wait_metadata: None,
            },
        );
    }

    assert!(
        !engine.delete_job(&job_id),
        "non-terminal Batch Compress child job should not be deletable",
    );

    let snapshot = engine.queue_state();
    assert!(
        snapshot.jobs.iter().any(|j| j.id == job_id),
        "non-terminal Batch Compress child job must remain in queue state after failed delete",
    );
}

#[test]
fn delete_batch_compress_batch_deletes_all_terminal_children_and_batch_metadata() {
    let engine = make_engine_with_preset();

    let batch_id = "batch-compress-batch-delete-all".to_string();
    let job1_id = "batch-compress-child-1".to_string();
    let job2_id = "batch-compress-child-2".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: BatchCompressBatchStatus::Completed,
                total_files_scanned: 2,
                total_candidates: 2,
                total_processed: 2,
                child_job_ids: vec![job1_id.clone(), job2_id.clone()],
                started_at_ms: 0,
                completed_at_ms: Some(0),
            },
        );

        let base_job = |id: &str, status: JobStatus| TranscodeJob {
            id: id.to_string(),
            filename: format!("C:/videos/{id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::BatchCompress,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status,
            progress: 100.0,
            start_time: Some(current_time_millis()),
            end_time: Some(current_time_millis()),
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: Some(5.0),
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/input.compressed.mp4".to_string()),
            output_policy: None,
            ffmpeg_command: None,
            runs: Vec::new(),
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: Some(batch_id.clone()),
            wait_metadata: None,
        };

        state
            .jobs
            .insert(job1_id.clone(), base_job(&job1_id, JobStatus::Completed));
        state
            .jobs
            .insert(job2_id.clone(), base_job(&job2_id, JobStatus::Skipped));
    }

    // 调用批次级删除接口，应该返回 true。
    assert!(
        engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must succeed when all children are terminal",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after
            .jobs
            .iter()
            .any(|j| j.id == job1_id || j.id == job2_id),
        "all Batch Compress children should be removed from queue state after batch delete",
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            !state.batch_compress_batches.contains_key(&batch_id),
            "Batch Compress batch metadata should be removed after delete_batch_compress_batch",
        );
    }
}

#[test]
fn delete_batch_compress_batch_rejects_when_children_are_not_terminal() {
    let engine = make_engine_with_preset();

    let batch_id = "batch-compress-batch-reject-non-terminal".to_string();
    let job1_id = "batch-compress-child-completed".to_string();
    let job2_id = "batch-compress-child-processing".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                // 即便批次元数据已经标记为 Completed，只要仍存在非终态子任务，
                // delete_batch_compress_batch 也应该拒绝删除，保持防御性行为。
                status: BatchCompressBatchStatus::Completed,
                total_files_scanned: 2,
                total_candidates: 2,
                total_processed: 1,
                child_job_ids: vec![job1_id.clone(), job2_id.clone()],
                started_at_ms: 0,
                completed_at_ms: Some(0),
            },
        );

        let base_job = |id: &str, status: JobStatus| {
            let progress = if matches!(status, JobStatus::Completed) {
                100.0
            } else {
                50.0
            };
            TranscodeJob {
                id: id.to_string(),
                filename: format!("C:/videos/{id}.mp4"),
                job_type: JobType::Video,
                source: JobSource::BatchCompress,
                queue_order: None,
                original_size_mb: 10.0,
                original_codec: Some("h264".to_string()),
                preset_id: "preset-1".to_string(),
                status,
                progress,
                start_time: Some(current_time_millis()),
                end_time: None,
                processing_started_ms: None,
                elapsed_ms: None,
                output_size_mb: None,
                logs: Vec::new(),
                log_head: None,
                skip_reason: None,
                input_path: Some("C:/videos/input.mp4".to_string()),
                output_path: None,
                output_policy: None,
                ffmpeg_command: None,
                runs: Vec::new(),
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                preview_revision: 0,
                log_tail: None,
                failure_reason: None,
                warnings: Vec::new(),
                batch_id: Some(batch_id.clone()),
                wait_metadata: None,
            }
        };

        state
            .jobs
            .insert(job1_id.clone(), base_job(&job1_id, JobStatus::Completed));
        state
            .jobs
            .insert(job2_id.clone(), base_job(&job2_id, JobStatus::Processing));
    }

    assert!(
        !engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must reject when any child job is non-terminal",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        snapshot_after.jobs.iter().any(|j| j.id == job1_id)
            && snapshot_after.jobs.iter().any(|j| j.id == job2_id),
        "no Batch Compress children should be removed when batch delete is rejected",
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            state.batch_compress_batches.contains_key(&batch_id),
            "batch metadata must remain intact when delete_batch_compress_batch is rejected",
        );
    }
}

#[test]
fn delete_batch_compress_batch_succeeds_when_status_is_running_but_all_children_are_terminal() {
    let engine = make_engine_with_preset();

    let batch_id = "batch-compress-batch-running-but-terminal".to_string();
    let job1_id = "batch-compress-child-terminal-1".to_string();
    let job2_id = "batch-compress-child-terminal-2".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        // 兼容旧状态：批次 status 可能残留为 Running，但只要统计已完成且子任务均为终态，
        // delete_batch_compress_batch 仍应允许删除。
        state.batch_compress_batches.insert(
            batch_id.clone(),
            BatchCompressBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: BatchCompressBatchStatus::Running,
                total_files_scanned: 2,
                total_candidates: 2,
                total_processed: 2,
                child_job_ids: vec![job1_id.clone(), job2_id.clone()],
                started_at_ms: 0,
                completed_at_ms: None,
            },
        );

        let base_job = |id: &str, status: JobStatus| TranscodeJob {
            id: id.to_string(),
            filename: format!("C:/videos/{id}.mp4"),
            job_type: JobType::Video,
            source: JobSource::BatchCompress,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status,
            progress: 100.0,
            start_time: Some(current_time_millis()),
            end_time: Some(current_time_millis()),
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: Some(5.0),
            logs: Vec::new(),
            log_head: None,
            skip_reason: None,
            input_path: Some(format!("C:/videos/{id}.mp4")),
            output_path: Some(format!("C:/videos/{id}.compressed.mp4")),
            output_policy: None,
            ffmpeg_command: None,
            runs: Vec::new(),
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            preview_revision: 0,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: Some(batch_id.clone()),
            wait_metadata: None,
        };

        state
            .jobs
            .insert(job1_id.clone(), base_job(&job1_id, JobStatus::Completed));
        state
            .jobs
            .insert(job2_id.clone(), base_job(&job2_id, JobStatus::Skipped));
    }

    assert!(
        engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must succeed when batch is logically complete even if status is Running",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after
            .jobs
            .iter()
            .any(|j| j.batch_id.as_deref() == Some(batch_id.as_str())),
        "all Batch Compress children should be removed after successful delete_batch_compress_batch",
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            !state.batch_compress_batches.contains_key(&batch_id),
            "batch metadata should be removed after successful delete_batch_compress_batch",
        );
    }
}
