use super::*;

#[test]
fn batch_compress_emits_scan_progress_updates_for_small_dirs_and_final_count() {
    let dir = env::temp_dir().join("ffui_batch_compress_progress_every_32");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create test dir");

    for index in 0..33 {
        let path = dir.join(format!("file-{index:02}.txt"));
        File::create(&path).unwrap_or_else(|_| panic!("create test file {}", path.display()));
    }

    let engine = make_engine_with_preset();

    let snapshots: TestArc<TestMutex<Vec<AutoCompressProgress>>> =
        TestArc::new(TestMutex::new(Vec::new()));
    let snapshots_clone = TestArc::clone(&snapshots);

    engine.register_batch_compress_listener(move |progress: AutoCompressProgress| {
        snapshots_clone
            .lock()
            .expect("snapshots lock poisoned")
            .push(progress);
    });

    let config = BatchCompressConfig {
        // Keep defaults but ensure the batch is still created.
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path.clone(), config)
        .expect("run_auto_compress should succeed");

    let batch_id = descriptor.batch_id.clone();

    // Wait for the background scan to finish (no eligible candidates so it should complete fast).
    let _summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.batch_compress_batch_summary(&batch_id)
                && summary.total_files_scanned >= 33
                && summary.total_candidates == 0
                && summary.total_processed == 0
            {
                break summary;
            }
            attempts += 1;
            if attempts > 200 {
                panic!("Batch Compress batch did not reach expected summary within timeout");
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    };

    let snapshots = snapshots.lock().expect("snapshots lock poisoned");
    let scanned_values = snapshots
        .iter()
        .filter(|s| s.batch_id == batch_id)
        .map(|s| s.total_files_scanned)
        .collect::<Vec<_>>();

    assert!(
        scanned_values.iter().any(|v| *v > 0 && *v < 33),
        "expected at least one intermediate scan progress snapshot for small dirs, got {scanned_values:?}"
    );
    assert_eq!(
        scanned_values.last().copied(),
        Some(33),
        "expected final scan progress snapshot to report totalFilesScanned=33, got {scanned_values:?}"
    );

    let mut last = 0u64;
    for v in scanned_values {
        assert!(
            v >= last,
            "scan progress should be monotonic, got {v} after {last}"
        );
        last = v;
    }
}
