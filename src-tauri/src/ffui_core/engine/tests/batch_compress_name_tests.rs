use super::*;
use crate::ffui_core::BatchCompressConfig;

#[test]
fn batch_compress_skips_compressed_named_outputs_as_candidates() {
    let dir = env::temp_dir().join("ffui_batch_compress_skip_compressed_output");
    let _ = fs::remove_dir_all(&dir);
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

    let config = BatchCompressConfig {
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
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for compressed-name test");

    let batch_id = descriptor.batch_id;

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
                "Batch Compress batch did not scan compressed-named video within timeout"
            );
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
        count, 0,
        "video named *.compressed.mp4 should be treated as a Batch Compress output and not enqueued"
    );
    assert_eq!(summary.total_candidates, 0);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn batch_compress_enqueues_avif_inputs_when_converting_to_webp() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let dir = env::temp_dir().join("ffui_batch_compress_avif_to_webp_input");
    let _ = fs::remove_dir_all(&dir);
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

    let mut config = BatchCompressConfig {
        min_image_size_kb: 0,
        min_video_size_mb: 10_000,
        min_audio_size_kb: 10_000,
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Webp,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };
    config.video_filter.enabled = false;
    config.audio_filter.enabled = false;
    config.image_filter.enabled = true;
    config.image_filter.extensions = vec!["avif".to_string()];

    let root_path = dir.to_string_lossy().into_owned();
    let descriptor = engine
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for avif-to-webp candidate test");

    let batch_id = descriptor.batch_id;

    let summary = {
        let mut attempts = 0;
        loop {
            if let Some(summary) = engine.batch_compress_batch_summary(&batch_id)
                && summary.total_files_scanned >= 1
                && summary.total_candidates >= 1
            {
                break summary;
            }
            attempts += 1;
            assert!(
                (attempts <= 100),
                "Batch Compress avif-to-webp test did not reach candidate state within timeout"
            );
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
        "supported AVIF inputs must remain eligible candidates"
    );
    assert_eq!(summary.total_candidates, 1);

    let _ = fs::remove_dir_all(&dir);
}
