use super::*;

/// 当 Batch Compress 配置中的 video_preset_id 在预设列表中不存在时，后台会将匹配到的
/// 视频视为“已统计候选并立即处理完成”，但不会入队任何子任务。此时批次应当被视为
/// 已完成，delete_batch_compress_batch 也必须返回 true 以便前端可以删除该复合任务。
#[test]
fn delete_batch_compress_batch_succeeds_for_candidates_without_children() {
    let dir = env::temp_dir().join("ffui_batch_compress_no_preset_delete");
    let _ = fs::create_dir_all(&dir);

    let video = dir.join("no-preset-video.mp4");
    {
        let mut file =
            File::create(&video).expect("create input video file for no-preset delete test");
        file.write_all(&[0u8; 1024])
            .expect("write input data for no-preset delete test");
    }

    let engine = make_engine_with_preset();

    let root_path = dir.to_string_lossy().into_owned();
    let config = BatchCompressConfig {
        root_path: Some(root_path.clone()),
        // 放宽体积阈值，确保该视频会被视为候选。
        min_image_size_kb: 0,
        min_video_size_mb: 0,
        min_audio_size_kb: 0,
        // 使用一个在测试预设集中不存在的 ID，触发“无匹配预设”分支。
        video_preset_id: "ffui-test-non-existent-preset".to_string(),
        ..Default::default()
    };

    let descriptor = engine
        .run_auto_compress(root_path.clone(), config)
        .expect("run_auto_compress should succeed even when video preset id is unknown");

    let batch_id = descriptor.batch_id.clone();

    // 等待 Batch Compress 批次统计结果稳定：应有 >=1 个候选且已全部处理完。
    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.batch_compress_batch_summary(&batch_id)
                && summary.total_files_scanned >= 1
                && summary.total_candidates >= 1
                && summary.total_processed >= summary.total_candidates
            {
                break summary;
            }
            attempts += 1;
            if attempts > 100 {
                panic!(
                    "Batch Compress batch did not reach expected summary (candidates without children) within timeout"
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    assert!(
        summary.total_candidates >= 1,
        "no-preset Batch Compress batch should report at least one candidate"
    );
    assert!(
        summary.total_processed >= summary.total_candidates,
        "no-preset Batch Compress batch should count all candidates as processed immediately"
    );

    // 队列中不应存在任何属于该批次的子任务。
    let snapshot = engine.queue_state();
    assert!(
        !snapshot
            .jobs
            .iter()
            .any(|j| j.batch_id.as_deref() == Some(batch_id.as_str())),
        "no-preset Batch Compress batch must not enqueue any child jobs"
    );

    // 修复之后，delete_batch_compress_batch 必须视这种“无子任务但所有候选已处理完成”的
    // 批次为可删除，并清理掉批次元数据，避免前端出现无法删除的空压缩任务。
    assert!(
        engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must succeed for batches with candidates but no child jobs (e.g. missing preset)"
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            !state.batch_compress_batches.contains_key(&batch_id),
            "Batch Compress batch metadata should be removed after successful delete_batch_compress_batch",
        );
    }

    let _ = fs::remove_dir_all(&dir);
}
