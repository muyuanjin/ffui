use super::*;

/// 回归测试：当 Batch Compress 批次里所有子任务都在入队时被直接判定为终态（Skipped）
/// 时，批次也必须被标记为 Completed，并允许 `delete_batch_compress_batch` 成功删除。
///
/// 这是为了修复“删除全部任务都跳过的压缩任务”时后端返回 false，导致前端无法删除复合任务的问题。
#[test]
fn delete_batch_compress_batch_succeeds_when_all_children_are_skipped() {
    let dir = env::temp_dir().join("ffui_batch_compress_all_skipped_delete");
    let _ = fs::create_dir_all(&dir);

    let video = dir.join("all-skipped-video.mp4");
    {
        let mut file =
            File::create(&video).expect("create input video file for all-skipped delete test");
        file.write_all(&[0u8; 1024])
            .expect("write input data for all-skipped delete test");
    }

    let engine = make_engine_with_preset();

    let root_path = dir.to_string_lossy().into_owned();
    let config = BatchCompressConfig {
        root_path: Some(root_path.clone()),
        min_image_size_kb: 0,
        // 让视频必定触发“体积太小 → 直接 skipped”逻辑。
        min_video_size_mb: 999_999,
        min_audio_size_kb: 0,
        ..Default::default()
    };

    let descriptor = engine
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for all-skipped delete test");

    let batch_id = descriptor.batch_id;

    // 等待 Batch Compress 批次状态稳定：应扫描到文件并将批次标记为 Completed。
    let attempts_limit = 120;
    for attempt in 0..attempts_limit {
        if let Some(summary) = engine.batch_compress_batch_summary(&batch_id)
            && summary.total_files_scanned >= 1
            && summary.total_candidates >= 1
            && summary.total_processed >= summary.total_candidates
        {
            let status = {
                let state = engine.inner.state.lock_unpoisoned();
                state
                    .batch_compress_batches
                    .get(&batch_id)
                    .map(|b| b.status)
            };
            if matches!(status, Some(BatchCompressBatchStatus::Completed)) {
                break;
            }
        }

        if attempt + 1 >= attempts_limit {
            let state = engine.inner.state.lock_unpoisoned();
            let debug = state.batch_compress_batches.get(&batch_id).cloned();
            panic!(
                "Batch Compress batch did not reach Completed (all skipped children) within timeout: {debug:?}"
            );
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // delete_batch_compress_batch 必须成功，并且清理批次元数据与子任务。
    assert!(
        engine.delete_batch_compress_batch(&batch_id),
        "delete_batch_compress_batch must succeed when all children are skipped/terminal"
    );

    {
        let state = engine.inner.state.lock_unpoisoned();
        assert!(
            !state.batch_compress_batches.contains_key(&batch_id),
            "Batch Compress batch metadata should be removed after successful delete_batch_compress_batch",
        );
    }

    let snapshot_after = engine.queue_state();
    assert!(
        !snapshot_after
            .jobs
            .iter()
            .any(|j| j.batch_id.as_deref() == Some(batch_id.as_str())),
        "all Batch Compress children should be removed after successful delete_batch_compress_batch",
    );

    let _ = fs::remove_dir_all(&dir);
}
