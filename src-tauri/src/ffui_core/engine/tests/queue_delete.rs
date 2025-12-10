use super::*;

#[test]
fn delete_job_only_allows_terminal_statuses() {
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
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
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
fn delete_smart_scan_child_job_is_deletable() {
    let engine = make_engine_with_preset();

    let batch_id = "smart-scan-batch-delete-test".to_string();
    let job_id = "smart-scan-job-delete-test".to_string();

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");

        // 为该批次注册一个简单的 Smart Scan 批次记录，模拟真实运行环境中的批次元数据。
        state.smart_scan_batches.insert(
            batch_id.clone(),
            SmartScanBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: SmartScanBatchStatus::Completed,
                total_files_scanned: 1,
                total_candidates: 1,
                total_processed: 1,
                child_job_ids: vec![job_id.clone()],
                started_at_ms: 0,
                completed_at_ms: Some(0),
            },
        );

        // 插入一个属于该 Smart Scan 批次、已完成状态的子任务。
        state.jobs.insert(
            job_id.clone(),
            TranscodeJob {
                id: job_id.clone(),
                filename: "C:/videos/input.mp4".to_string(),
                job_type: JobType::Video,
                source: JobSource::SmartScan,
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
                skip_reason: None,
                input_path: Some("C:/videos/input.mp4".to_string()),
                output_path: Some("C:/videos/input.compressed.mp4".to_string()),
                ffmpeg_command: None,
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                batch_id: Some(batch_id.clone()),
                wait_metadata: None,
            },
        );
    }

    // Smart Scan 的子任务同样应该可以被 delete_job 删除，并从队列快照中消失。
    assert!(
        engine.delete_job(&job_id),
        "Smart Scan child job in terminal state should be deletable",
    );

    let snapshot = engine.queue_state();
    assert!(
        !snapshot.jobs.iter().any(|j| j.id == job_id),
        "Smart Scan child job must be removed from queue state after delete",
    );
}

#[test]
fn delete_smart_scan_non_terminal_job_is_rejected() {
    let engine = make_engine_with_preset();

    let batch_id = "smart-scan-batch-reject-test".to_string();
    let job_id = "smart-scan-job-reject-test".to_string();

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");

        state.smart_scan_batches.insert(
            batch_id.clone(),
            SmartScanBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: SmartScanBatchStatus::Running,
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
                source: JobSource::SmartScan,
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
                skip_reason: None,
                input_path: Some("C:/videos/input.mp4".to_string()),
                output_path: None,
                ffmpeg_command: None,
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
                batch_id: Some(batch_id.clone()),
                wait_metadata: None,
            },
        );
    }

    assert!(
        !engine.delete_job(&job_id),
        "non-terminal Smart Scan child job should not be deletable",
    );

    let snapshot = engine.queue_state();
    assert!(
        snapshot.jobs.iter().any(|j| j.id == job_id),
        "non-terminal Smart Scan child job must remain in queue state after failed delete",
    );
}

#[test]
fn delete_smart_scan_batch_deletes_all_terminal_children_and_batch_metadata() {
    let engine = make_engine_with_preset();

    let batch_id = "smart-scan-batch-delete-all".to_string();
    let job1_id = "smart-scan-child-1".to_string();
    let job2_id = "smart-scan-child-2".to_string();

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");

        state.smart_scan_batches.insert(
            batch_id.clone(),
            SmartScanBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                status: SmartScanBatchStatus::Completed,
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
            source: JobSource::SmartScan,
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
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/input.compressed.mp4".to_string()),
            ffmpeg_command: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
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
        engine.delete_smart_scan_batch(&batch_id),
        "delete_smart_scan_batch must succeed when all children are terminal",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after
            .jobs
            .iter()
            .any(|j| j.id == job1_id || j.id == job2_id),
        "all Smart Scan children should be removed from queue state after batch delete",
    );

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        assert!(
            !state.smart_scan_batches.contains_key(&batch_id),
            "Smart Scan batch metadata should be removed after delete_smart_scan_batch",
        );
    }
}

#[test]
fn delete_smart_scan_batch_rejects_when_children_are_not_terminal() {
    let engine = make_engine_with_preset();

    let batch_id = "smart-scan-batch-reject-non-terminal".to_string();
    let job1_id = "smart-scan-child-completed".to_string();
    let job2_id = "smart-scan-child-processing".to_string();

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");

        state.smart_scan_batches.insert(
            batch_id.clone(),
            SmartScanBatch {
                batch_id: batch_id.clone(),
                root_path: "C:/videos".to_string(),
                replace_original: false,
                // 即便批次元数据已经标记为 Completed，只要仍存在非终态子任务，
                // delete_smart_scan_batch 也应该拒绝删除，保持防御性行为。
                status: SmartScanBatchStatus::Completed,
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
                source: JobSource::SmartScan,
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
                skip_reason: None,
                input_path: Some("C:/videos/input.mp4".to_string()),
                output_path: None,
                ffmpeg_command: None,
                media_info: None,
                estimated_seconds: None,
                preview_path: None,
                log_tail: None,
                failure_reason: None,
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
        !engine.delete_smart_scan_batch(&batch_id),
        "delete_smart_scan_batch must reject when any child job is non-terminal",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        snapshot_after.jobs.iter().any(|j| j.id == job1_id)
            && snapshot_after.jobs.iter().any(|j| j.id == job2_id),
        "no Smart Scan children should be removed when batch delete is rejected",
    );

    {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        assert!(
            state.smart_scan_batches.contains_key(&batch_id),
            "batch metadata must remain intact when delete_smart_scan_batch is rejected",
        );
    }
}
