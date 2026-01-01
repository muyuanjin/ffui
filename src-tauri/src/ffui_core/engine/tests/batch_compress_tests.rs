use super::*;
use crate::ffui_core::BatchCompressConfig;
#[test]
fn run_auto_compress_emits_monotonic_progress_and_matches_summary() {
    let dir = env::temp_dir().join("ffui_batch_compress_progress");
    let _ = fs::create_dir_all(&dir);

    let image1 = dir.join("small1.jpg");
    let image2 = dir.join("small2.png");
    let video1 = dir.join("small1.mp4");

    for path in [&image1, &image2, &video1] {
        let mut file =
            File::create(path).unwrap_or_else(|_| panic!("create test file {}", path.display()));
        let data = vec![0u8; 4 * 1024];
        file.write_all(&data)
            .unwrap_or_else(|_| panic!("write data for {}", path.display()));
    }

    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<AutoCompressProgress>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_batch_compress_listener(move |progress: AutoCompressProgress| {
        snapshots_clone.lock_unpoisoned().push(progress);
    });

    let config = BatchCompressConfig {
        min_image_size_kb: 10_000,
        min_video_size_mb: 10_000,
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path.clone(), config)
        .expect("run_auto_compress should succeed for synthetic tree");

    let batch_id = descriptor.batch_id;

    // 等待后台 Batch Compress 批次完成，最多轮询约 5 秒。
    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.batch_compress_batch_summary(&batch_id)
                && summary.total_files_scanned >= 3
                && summary.total_candidates >= 3
                && summary.total_processed >= 3
            {
                break summary;
            }
            attempts += 1;
            assert!(
                (attempts <= 100),
                "Batch Compress batch did not reach expected summary within timeout"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    let snapshots_lock = snapshots.lock_unpoisoned();
    assert!(
        !snapshots_lock.is_empty(),
        "Batch Compress must emit at least one progress snapshot during run_auto_compress"
    );

    let mut last_scanned = 0u64;
    let mut last_candidates = 0u64;
    let mut last_processed = 0u64;

    for snap in snapshots_lock.iter() {
        assert_eq!(
            snap.root_path, root_path,
            "all progress snapshots must use the same rootPath as the final result"
        );
        assert!(
            snap.total_files_scanned >= last_scanned,
            "total_files_scanned must be monotonic (prev={last_scanned}, current={})",
            snap.total_files_scanned
        );
        assert!(
            snap.total_candidates >= last_candidates,
            "total_candidates must be monotonic (prev={last_candidates}, current={})",
            snap.total_candidates
        );
        assert!(
            snap.total_processed >= last_processed,
            "total_processed must be monotonic (prev={last_processed}, current={})",
            snap.total_processed
        );
        last_scanned = snap.total_files_scanned;
        last_candidates = snap.total_candidates;
        last_processed = snap.total_processed;
    }

    assert_eq!(
        last_scanned, summary.total_files_scanned,
        "final progress snapshot total_files_scanned must match Batch Compress batch summary"
    );
    assert_eq!(
        last_candidates, summary.total_candidates,
        "final progress snapshot total_candidates must match Batch Compress batch summary"
    );
    assert_eq!(
        last_processed, summary.total_processed,
        "final progress snapshot total_processed must match Batch Compress batch summary"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn run_auto_compress_progress_listener_can_call_queue_state_without_deadlock() {
    let dir = env::temp_dir().join("ffui_batch_compress_lock_free");
    let _ = fs::create_dir_all(&dir);

    let video = dir.join("sample_lock_free.mp4");
    {
        let mut file = File::create(&video)
            .unwrap_or_else(|_| panic!("create lock-free test file {}", video.display()));
        let data = vec![0u8; 4 * 1024];
        file.write_all(&data)
            .unwrap_or_else(|_| panic!("write data for lock-free test file {}", video.display()));
    }

    let engine = make_engine_with_preset();
    let engine_clone = engine.clone();

    let snapshots: TestArc<TestMutex<Vec<AutoCompressProgress>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    // If run_auto_compress ever holds the engine state lock while notifying
    // listeners, calling queue_state() from inside the listener would
    // deadlock. This test ensures the implementation remains lock-free for
    // progress notifications.
    engine.register_batch_compress_listener(move |progress: AutoCompressProgress| {
        let _ = engine_clone.queue_state();
        snapshots_clone.lock_unpoisoned().push(progress);
    });

    let config = BatchCompressConfig {
        min_image_size_kb: 10_000,
        min_video_size_mb: 10_000,
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for lock-free listener test");

    let batch_id = descriptor.batch_id;

    // 等待批次完成以便能够读取稳定的汇总信息。
    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.batch_compress_batch_summary(&batch_id)
                && summary.total_files_scanned >= 1
            {
                break summary;
            }
            attempts += 1;
            assert!(
                (attempts <= 100),
                "Batch Compress batch did not finish within timeout in lock-free test"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    let snapshots_lock = snapshots.lock_unpoisoned();
    assert!(
        !snapshots_lock.is_empty(),
        "Batch Compress progress listener should have been invoked at least once"
    );

    assert_eq!(
        summary.total_files_scanned, 1,
        "lock-free test tree contains exactly one file"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn batch_compress_pushes_full_batch_snapshot_after_detection() {
    let dir = env::temp_dir().join("ffui_batch_compress_full_snapshot");
    let _ = fs::create_dir_all(&dir);

    let video1 = dir.join("full-1.mp4");
    let video2 = dir.join("full-2.mkv");

    for path in [&video1, &video2] {
        let mut file =
            File::create(path).unwrap_or_else(|_| panic!("create test file {}", path.display()));
        let data = vec![0u8; 4 * 1024];
        file.write_all(&data)
            .unwrap_or_else(|_| panic!("write data for {}", path.display()));
    }

    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<QueueState>>> = TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_queue_listener(move |state: QueueState| {
        snapshots_clone.lock_unpoisoned().push(state);
    });

    let config = BatchCompressConfig {
        min_image_size_kb: 0,
        min_video_size_mb: 10_000,
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for full snapshot test");

    let batch_id = descriptor.batch_id;

    // 等待监听器接收到包含所有子任务的快照，最多轮询约 5 秒。
    let mut attempts = 0;
    loop {
        let (has_partial, has_full) = {
            let states = snapshots.lock_unpoisoned();
            let mut partial = false;
            let mut full = false;
            for state in states.iter() {
                let count = state
                    .jobs
                    .iter()
                    .filter(|j| j.batch_id.as_deref() == Some(batch_id.as_str()))
                    .count();
                if count > 0 && count < 2 {
                    partial = true;
                } else if count >= 2 {
                    full = true;
                }
            }
            (partial, full)
        };

        if has_full {
            assert!(
                !has_partial,
                "Batch Compress 队列快照应一次性包含该批次的全部子任务，而不是逐个追加"
            );
            break;
        }

        attempts += 1;
        assert!(
            (attempts <= 100),
            "Batch Compress queue snapshot did not include all children within timeout"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn batch_compress_video_output_naming_avoids_overwrites() {
    let dir = env::temp_dir().join("ffui_batch_compress_safe_outputs");
    let _ = fs::create_dir_all(&dir);

    let input = dir.join("sample.mp4");
    {
        let mut file = File::create(&input).expect("create input video file for safe output test");
        file.write_all(&[0u8; 1024])
            .expect("write input data for safe output test");
    }

    let existing1 = dir.join("sample.compressed.mp4");
    let existing2 = dir.join("sample.compressed (1).mp4");

    for path in [&existing1, &existing2] {
        let mut file = File::create(path)
            .unwrap_or_else(|_| panic!("create existing output {}", path.display()));
        file.write_all(b"existing-output")
            .unwrap_or_else(|_| panic!("write existing output {}", path.display()));
    }

    let presets = vec![make_test_preset()];
    let settings = AppSettings::default();
    let mut state = EngineState::new(presets, settings);

    // Simulate outputs from a previous Batch Compress run.
    state
        .known_batch_compress_outputs
        .insert(existing1.to_string_lossy().into_owned());
    state
        .known_batch_compress_outputs
        .insert(existing2.to_string_lossy().into_owned());

    let preset_ref = state.presets.first().expect("preset must exist").clone();
    let first = reserve_unique_batch_compress_video_output_path(&mut state, &input, &preset_ref);
    assert_ne!(
        first, existing1,
        "first Batch Compress output path must not overwrite pre-existing sample.compressed.mp4"
    );
    assert_ne!(
        first, existing2,
        "first Batch Compress output path must not overwrite pre-existing sample.compressed (1).mp4"
    );

    let second = reserve_unique_batch_compress_video_output_path(&mut state, &input, &preset_ref);
    assert_ne!(
        second, first,
        "subsequent Batch Compress output path must differ from previously reserved path"
    );
    assert_ne!(
        second, existing1,
        "second Batch Compress output path must not overwrite pre-existing outputs"
    );
    assert_ne!(
        second, existing2,
        "second Batch Compress output path must not overwrite pre-existing outputs"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn batch_compress_batch_carries_replace_original_flag() {
    let dir = env::temp_dir().join("ffui_batch_compress_replace_flag");
    let _ = fs::create_dir_all(&dir);

    let engine = make_engine_with_preset();

    let root_path = dir.to_string_lossy().into_owned();

    let config = BatchCompressConfig {
        root_path: Some(root_path.clone()),
        replace_original: true,
        min_image_size_kb: 0,
        min_video_size_mb: 0,
        min_saving_ratio: 0.0,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let descriptor = engine
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for replace_original flag test");

    let batch_id = descriptor.batch_id;

    {
        let state = engine.inner.state.lock_unpoisoned();
        let batch = state
            .batch_compress_batches
            .get(&batch_id)
            .expect("Batch Compress batch should be registered immediately");
        assert!(
            batch.replace_original,
            "BatchCompressBatch.replace_original must mirror BatchCompressConfig.replace_original",
        );
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn batch_compress_does_not_reenqueue_known_outputs_as_candidates() {
    let dir = env::temp_dir().join("ffui_batch_compress_dedup");
    let _ = fs::create_dir_all(&dir);

    let input = dir.join("video.mp4");
    let output = dir.join("video.compressed.mp4");

    for path in [&input, &output] {
        let mut file =
            File::create(path).unwrap_or_else(|_| panic!("create test file {}", path.display()));
        file.write_all(&[0u8; 1024])
            .unwrap_or_else(|_| panic!("write data for {}", path.display()));
    }

    let engine = make_engine_with_preset();

    // Simulate that `output` is a known Batch Compress output from a previous run.
    register_known_batch_compress_output_with_inner(&engine.inner, &output);

    // A known output path should always be treated as "skip as candidate".
    let output_is_known = is_known_batch_compress_output_with_inner(&engine.inner, &output)
        || is_batch_compress_style_output(&output);
    assert!(
        output_is_known,
        "Batch Compress must treat video.compressed.mp4 as a known output when evaluating candidates"
    );

    // The original input path must remain eligible as a candidate.
    let input_is_known = is_known_batch_compress_output_with_inner(&engine.inner, &input)
        || is_batch_compress_style_output(&input);
    assert!(
        !input_is_known,
        "original input video.mp4 must not be treated as a known output and must remain eligible"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn batch_compress_video_output_uses_container_extension_when_present() {
    let dir = env::temp_dir().join("ffui_batch_compress_mkv_ext");
    let _ = fs::create_dir_all(&dir);

    let input = dir.join("movie.mp4");
    {
        let mut file =
            File::create(&input).expect("create input video file for mkv extension test");
        file.write_all(&[0u8; 1024])
            .expect("write input data for mkv extension test");
    }

    // 预设声明 mkv 容器。
    let mut preset = make_test_preset();
    preset.id = "preset-mkv".to_string();
    preset.container = Some(ContainerConfig {
        format: Some("mkv".to_string()),
        movflags: None,
    });

    let settings = AppSettings::default();
    let mut state = EngineState::new(vec![preset], settings);
    let preset_ref = state.presets.first().expect("preset must exist").clone();

    let p = reserve_unique_batch_compress_video_output_path(&mut state, &input, &preset_ref);

    assert!(
        p.to_string_lossy().ends_with(".compressed.mkv"),
        "Batch Compress 预设使用 container.format=mkv 时，输出路径应以 .compressed.mkv 结尾，实际为 {}",
        p.display()
    );

    let _ = fs::remove_dir_all(&dir);
}
