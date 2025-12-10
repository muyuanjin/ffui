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
