use super::*;

#[test]
fn delete_batch_compress_batch_succeeds_without_batch_metadata_when_all_children_are_terminal() {
    let engine = make_engine_with_preset();

    let batch_id = "legacy-batch-compress-without-metadata".to_string();
    let job1_id = "legacy-batch-child-terminal-1".to_string();
    let job2_id = "legacy-batch-child-terminal-2".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

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

        // Simulate crash recovery: child jobs carry batch_id, but the backend
        // did not restore batch_compress_batches metadata.
        state
            .jobs
            .insert(job1_id.clone(), base_job(&job1_id, JobStatus::Completed));
        state
            .jobs
            .insert(job2_id.clone(), base_job(&job2_id, JobStatus::Skipped));
        state.queue.push_back(job1_id);
        state.queue.push_back(job2_id);
    }

    assert!(
        engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must succeed when metadata is missing but all children are terminal",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after
            .jobs
            .iter()
            .any(|j| j.batch_id.as_deref() == Some(batch_id.as_str())),
        "all Batch Compress children should be removed when deleting a legacy batch without metadata",
    );
}

#[test]
fn delete_batch_compress_batch_rejects_without_batch_metadata_when_any_child_is_non_terminal() {
    let engine = make_engine_with_preset();

    let batch_id = "legacy-batch-compress-without-metadata-non-terminal".to_string();
    let job1_id = "legacy-batch-child-terminal".to_string();
    let job2_id = "legacy-batch-child-non-terminal".to_string();

    {
        let mut state = engine.inner.state.lock_unpoisoned();

        let base_job = |id: &str, status: JobStatus| {
            let progress = if status == JobStatus::Processing {
                30.0
            } else {
                100.0
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
                input_path: Some(format!("C:/videos/{id}.mp4")),
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
        state.queue.push_back(job1_id.clone());
        state.queue.push_back(job2_id.clone());
    }

    assert!(
        !engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must reject legacy batches when any child is non-terminal",
    );

    let snapshot_after = engine.queue_state();
    assert!(
        snapshot_after.jobs.iter().any(|j| j.id == job1_id)
            && snapshot_after.jobs.iter().any(|j| j.id == job2_id),
        "no children should be removed when rejecting a legacy batch delete",
    );
}
