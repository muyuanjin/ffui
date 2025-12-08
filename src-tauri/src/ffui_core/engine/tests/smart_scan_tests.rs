use super::*;
#[test]
fn run_auto_compress_emits_monotonic_progress_and_matches_summary() {
    let dir = env::temp_dir().join("ffui_smart_scan_progress");
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

    engine.register_smart_scan_listener(move |progress: AutoCompressProgress| {
        snapshots_clone
            .lock()
            .expect("snapshots lock poisoned")
            .push(progress);
    });

    let config = SmartScanConfig {
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

    let batch_id = descriptor.batch_id.clone();

    // 等待后台 Smart Scan 批次完成，最多轮询约 5 秒。
    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.smart_scan_batch_summary(&batch_id)
                && summary.total_files_scanned >= 3
                && summary.total_candidates >= 3
                && summary.total_processed >= 3
            {
                break summary;
            }
            attempts += 1;
            if attempts > 100 {
                panic!("Smart Scan batch did not reach expected summary within timeout");
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    let snapshots_lock = snapshots.lock().expect("snapshots lock poisoned");
    assert!(
        !snapshots_lock.is_empty(),
        "Smart Scan must emit at least one progress snapshot during run_auto_compress"
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
        "final progress snapshot total_files_scanned must match Smart Scan batch summary"
    );
    assert_eq!(
        last_candidates, summary.total_candidates,
        "final progress snapshot total_candidates must match Smart Scan batch summary"
    );
    assert_eq!(
        last_processed, summary.total_processed,
        "final progress snapshot total_processed must match Smart Scan batch summary"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn run_auto_compress_progress_listener_can_call_queue_state_without_deadlock() {
    let dir = env::temp_dir().join("ffui_smart_scan_lock_free");
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
    engine.register_smart_scan_listener(move |progress: AutoCompressProgress| {
        let _ = engine_clone.queue_state();
        snapshots_clone
            .lock()
            .expect("snapshots lock poisoned")
            .push(progress);
    });

    let config = SmartScanConfig {
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
        .expect("run_auto_compress should succeed for lock-free listener test");

    let batch_id = descriptor.batch_id.clone();

    // 等待批次完成以便能够读取稳定的汇总信息。
    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.smart_scan_batch_summary(&batch_id)
                && summary.total_files_scanned >= 1
            {
                break summary;
            }
            attempts += 1;
            if attempts > 100 {
                panic!("Smart Scan batch did not finish within timeout in lock-free test");
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    let snapshots_lock = snapshots.lock().expect("snapshots lock poisoned");
    assert!(
        !snapshots_lock.is_empty(),
        "Smart Scan progress listener should have been invoked at least once"
    );

    assert_eq!(
        summary.total_files_scanned, 1,
        "lock-free test tree contains exactly one file"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn smart_scan_video_output_naming_avoids_overwrites() {
    let dir = env::temp_dir().join("ffui_smart_scan_safe_outputs");
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

    // Simulate outputs from a previous Smart Scan run.
    state
        .known_smart_scan_outputs
        .insert(existing1.to_string_lossy().into_owned());
    state
        .known_smart_scan_outputs
        .insert(existing2.to_string_lossy().into_owned());

    let first = reserve_unique_smart_scan_video_output_path(&mut state, &input);
    assert_ne!(
        first, existing1,
        "first Smart Scan output path must not overwrite pre-existing sample.compressed.mp4"
    );
    assert_ne!(
        first, existing2,
        "first Smart Scan output path must not overwrite pre-existing sample.compressed (1).mp4"
    );

    let second = reserve_unique_smart_scan_video_output_path(&mut state, &input);
    assert_ne!(
        second, first,
        "subsequent Smart Scan output path must differ from previously reserved path"
    );
    assert_ne!(
        second, existing1,
        "second Smart Scan output path must not overwrite pre-existing outputs"
    );
    assert_ne!(
        second, existing2,
        "second Smart Scan output path must not overwrite pre-existing outputs"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn smart_scan_does_not_reenqueue_known_outputs_as_candidates() {
    let dir = env::temp_dir().join("ffui_smart_scan_dedup");
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

    // Simulate that `output` is a known Smart Scan output from a previous run.
    register_known_smart_scan_output_with_inner(&engine.inner, &output);

    // A known output path should always be treated as "skip as candidate".
    let output_is_known = is_known_smart_scan_output_with_inner(&engine.inner, &output)
        || is_smart_scan_style_output(&output);
    assert!(
        output_is_known,
        "Smart Scan must treat video.compressed.mp4 as a known output when evaluating candidates"
    );

    // The original input path must remain eligible as a candidate.
    let input_is_known = is_known_smart_scan_output_with_inner(&engine.inner, &input)
        || is_smart_scan_style_output(&input);
    assert!(
        !input_is_known,
        "original input video.mp4 must not be treated as a known output and must remain eligible"
    );

    let _ = fs::remove_dir_all(&dir);
}
