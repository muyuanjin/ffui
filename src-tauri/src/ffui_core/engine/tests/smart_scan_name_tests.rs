use super::*;

#[test]
fn smart_scan_keeps_compressed_named_files_as_candidates() {
    let dir = env::temp_dir().join("ffui_smart_scan_keep_compressed_named");
    let _ = fs::create_dir_all(&dir);

    let video = dir.join("sample.compressed.mp4");
    {
        let mut file =
            File::create(&video).unwrap_or_else(|_| panic!("create test file {}", video.display()));
        let data = vec![0u8; 4 * 1024];
        file.write_all(&data)
            .unwrap_or_else(|_| panic!("write data for {}", video.display()));
    }

    let engine = make_engine_with_preset();

    let config = SmartScanConfig {
        min_image_size_kb: 0,
        min_video_size_mb: 0,
        min_audio_size_kb: 0,
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path.clone(), config)
        .expect("run_auto_compress should succeed for compressed-name test");

    let batch_id = descriptor.batch_id.clone();

    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.smart_scan_batch_summary(&batch_id)
                && summary.total_files_scanned >= 1
                && summary.total_candidates >= 1
            {
                break summary;
            }
            attempts += 1;
            if attempts > 100 {
                panic!("Smart Scan batch did not include compressed-named video within timeout");
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    let queue = engine.queue_state();
    let count = queue
        .jobs
        .iter()
        .filter(|j| j.batch_id.as_deref() == Some(batch_id.as_str()))
        .count();

    assert_eq!(
        count, 1,
        "video named *.compressed.mp4 should still be enqueued as a Smart Scan candidate"
    );
    assert!(
        summary.total_candidates >= 1,
        "Smart Scan should treat compressed-named video as candidate"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn smart_scan_treats_avif_as_candidate_when_enabled() {
    let dir = env::temp_dir().join("ffui_smart_scan_avif_candidate");
    let _ = fs::create_dir_all(&dir);

    let image = dir.join("photo.avif");
    {
        let mut file =
            File::create(&image).unwrap_or_else(|_| panic!("create avif file {}", image.display()));
        let data = vec![0u8; 4 * 1024];
        file.write_all(&data)
            .unwrap_or_else(|_| panic!("write data for {}", image.display()));
    }

    let engine = make_engine_with_preset();

    let config = SmartScanConfig {
        min_image_size_kb: 0,
        min_video_size_mb: 10_000,
        min_audio_size_kb: 10_000,
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path.clone(), config)
        .expect("run_auto_compress should succeed for avif candidate test");

    let batch_id = descriptor.batch_id.clone();

    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.smart_scan_batch_summary(&batch_id)
                && summary.total_files_scanned >= 1
                && summary.total_candidates >= 1
                && summary.total_processed >= 1
            {
                break summary;
            }
            attempts += 1;
            if attempts > 100 {
                panic!("Smart Scan avif test did not reach processed state within timeout");
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };

    let queue = engine.queue_state();
    let count = queue
        .jobs
        .iter()
        .filter(|j| j.batch_id.as_deref() == Some(batch_id.as_str()))
        .count();

    assert_eq!(
        count, 1,
        "avif file should still appear as a Smart Scan job when image compression is enabled"
    );
    assert!(
        summary.total_processed >= 1,
        "avif candidate should be marked processed (usually skipped) after background handling"
    );

    let _ = fs::remove_dir_all(&dir);
}
