use super::*;
use crate::ffui_core::BatchCompressConfig;

#[test]
fn batch_compress_enqueues_audio_candidates_when_enabled() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let dir = tempfile::tempdir().expect("temp batch compress audio root");
    let dir = dir.path();

    let audio = dir.join("sample-audio.mp3");
    {
        let mut file =
            File::create(&audio).expect("create audio file for Batch Compress audio test");
        // 1KB 小文件，配合较大的 min_audio_size_kb 触发“体积过小直接跳过”分支，避免在单元测试中真正运行
        // ffmpeg。
        file.write_all(&[0u8; 1024])
            .expect("write data for Batch Compress audio test");
    }

    let engine = make_engine_with_preset();

    let root_path = dir.to_string_lossy().into_owned();

    let mut config = BatchCompressConfig {
        root_path: Some(root_path.clone()),
        replace_original: false,
        min_image_size_kb: 10_000,
        min_video_size_mb: 10_000,
        // 设为大于 1KB，以便在 handle_audio_file 中直接命中最小体积跳过逻辑。
        min_audio_size_kb: 2_048,
        min_saving_ratio: 0.95,
        min_saving_absolute_mb: 5.0,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    // 仅开启音频过滤，并确保包含 mp3 扩展名。
    config.video_filter.enabled = false;
    config.image_filter.enabled = false;
    config.audio_filter.enabled = true;
    if !config
        .audio_filter
        .extensions
        .iter()
        .any(|e| e.eq_ignore_ascii_case("mp3"))
    {
        config.audio_filter.extensions.push("mp3".to_string());
    }

    let descriptor = engine
        .run_auto_compress(root_path, config)
        .expect("run_auto_compress should succeed for audio-only Batch Compress test");

    let batch_id = descriptor.batch_id;

    {
        let mut attempts = 0;
        loop {
            let state = engine.inner.state.lock_unpoisoned();
            let maybe_audio_job_id = state.jobs.values().find_map(|job| {
                (job.batch_id.as_deref() == Some(batch_id.as_str())
                    && job.job_type == JobType::Audio)
                    .then(|| job.id.clone())
            });
            if let Some(job_id) = maybe_audio_job_id {
                assert!(
                    state.queue.iter().any(|queued| queued == &job_id),
                    "Batch Compress audio child must enter the normal worker queue"
                );
                assert!(
                    !state.active_batch_compress_media_jobs.contains(&job_id),
                    "Batch Compress audio child must not be registered to the legacy media-worker bypass"
                );
                break;
            }
            drop(state);
            attempts += 1;
            assert!(
                attempts <= 100,
                "Batch Compress audio child was not created within timeout"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    let job_id = {
        let mut state = engine.inner.state.lock_unpoisoned();
        next_job_for_worker_locked(&mut state)
            .expect("audio child should be selectable by normal worker")
    };
    process_transcode_job(&engine.inner, &job_id)
        .expect("normal worker should process audio child");
    {
        let mut state = engine.inner.state.lock_unpoisoned();
        finish_job_and_try_start_next_locked(&mut state, &job_id);
    }

    let summary = engine
        .batch_compress_batch_summary(&batch_id)
        .expect("Batch Compress summary should remain available");

    assert_eq!(
        summary.total_files_scanned, 1,
        "audio-only Batch Compress tree contains exactly one file"
    );
    assert_eq!(
        summary.total_candidates, 1,
        "audio-only Batch Compress must treat the mp3 file as a single candidate"
    );
    assert_eq!(
        summary.total_processed, 1,
        "audio-only Batch Compress candidate must be immediately marked as processed"
    );

    // 确认队列中存在对应的音频子任务，并且类型为 audio、状态为 skipped。
    let queue = engine.queue_state();
    let audio_jobs: Vec<_> = queue
        .jobs
        .into_iter()
        .filter(|j| {
            j.batch_id.as_deref() == Some(batch_id.as_str()) && j.job_type == JobType::Audio
        })
        .collect();

    assert_eq!(
        audio_jobs.len(),
        1,
        "Batch Compress must enqueue exactly one audio job for the mp3 candidate"
    );

    let job = &audio_jobs[0];
    assert_eq!(
        job.status,
        JobStatus::Skipped,
        "audio job with too-small size should be marked as Skipped"
    );
    let reason = job.skip_reason.clone().unwrap_or_default();
    assert!(
        reason.contains("Size <"),
        "skipReason for audio job should describe minimum size check, got: {reason}"
    );
}

#[test]
fn invalid_audio_preset_id_falls_back_to_default_and_clears_job_preset() {
    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard =
        crate::ffui_core::data_root::override_data_root_dir_for_tests(data_root.path().into());

    let audio = data_root.path().join("stale-preset.mp3");
    fs::write(&audio, vec![0u8; 1024]).expect("write audio input");

    let inner = Inner::new(vec![make_test_preset()], AppSettings::default());
    let config = BatchCompressConfig {
        min_audio_size_kb: 2_048,
        audio_preset_id: Some("stale-audio-preset".to_string()),
        ..Default::default()
    };

    let job = handle_audio_file_with_id(
        &inner,
        &audio,
        &config,
        &AppSettings::default(),
        inner.state.lock_unpoisoned().presets.as_ref(),
        "batch-stale-audio-preset",
        Some("job-stale-audio-preset".to_string()),
    )
    .expect("small audio file should use skip path without running ffmpeg");

    assert_eq!(
        job.preset_id, "",
        "stale non-empty audio preset ids must be normalized to default audio compression"
    );
    assert!(
        job.log_tail
            .as_deref()
            .is_some_and(|tail| tail.contains("falling back to default audio compression")),
        "job log should explain stale audio preset fallback"
    );
}
