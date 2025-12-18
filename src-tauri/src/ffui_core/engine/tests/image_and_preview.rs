use super::*;
#[test]
fn build_preview_output_path_is_stable_for_same_input() {
    let dir = env::temp_dir();
    let path = dir.join("preview_target.mp4");

    let first = build_preview_output_path(&path, 25);
    let second = build_preview_output_path(&path, 25);

    assert_eq!(
        first, second,
        "preview path must be stable for the same input file"
    );

    let filename = first
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    assert!(
        filename.ends_with(".jpg"),
        "preview path should use a .jpg extension, got {filename}"
    );
}

#[test]
fn build_preview_output_path_changes_when_capture_percent_differs() {
    let dir = env::temp_dir();
    let path = dir.join("preview_target_percent.mp4");

    let twenty_five = build_preview_output_path(&path, 25);
    let fifty = build_preview_output_path(&path, 50);

    assert_ne!(
        twenty_five, fifty,
        "preview path should differ when capture percent differs for the same input"
    );

    assert!(
        !twenty_five.exists() && !fifty.exists(),
        "path computation tests should not accidentally create files"
    );
}

#[test]
fn image_avif_paths_use_tmp_avif_extension() {
    let path = PathBuf::from("C:/images/sample.png");
    let (avif_target, tmp_output) = build_image_avif_paths(&path);

    let target_str = avif_target.to_string_lossy();
    let tmp_str = tmp_output.to_string_lossy();

    assert!(
        target_str.ends_with(".avif"),
        "final AVIF target must end with .avif, got {target_str}"
    );
    assert!(
        tmp_str.ends_with(".tmp.avif"),
        "temporary AVIF output must end with .tmp.avif so tools can infer AVIF container from extension, got {tmp_str}"
    );
}

#[test]
fn handle_image_file_uses_existing_avif_sibling_as_preview_path() {
    let dir = env::temp_dir().join("ffui_image_preview_existing_avif");
    let _ = fs::create_dir_all(&dir);

    let png = dir.join("sample.png");
    let avif = dir.join("sample.avif");

    // Create a small PNG and a sibling AVIF file.
    {
        let mut f = File::create(&png).unwrap_or_else(|_| panic!("create png {}", png.display()));
        f.write_all(&vec![0u8; 4 * 1024])
            .unwrap_or_else(|_| panic!("write png {}", png.display()));
    }
    {
        let mut f =
            File::create(&avif).unwrap_or_else(|_| panic!("create avif {}", avif.display()));
        f.write_all(b"avif-data")
            .unwrap_or_else(|_| panic!("write avif {}", avif.display()));
    }

    let engine = make_engine_with_preset();

    let settings = {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        state.settings.clone()
    };

    let config = BatchCompressConfig {
        min_image_size_kb: 1,      // treat the tiny PNG as a valid candidate
        min_video_size_mb: 10_000, // unused here
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let job = handle_image_file(
        &engine.inner,
        &png,
        &config,
        &settings,
        "batch-image-preview",
    )
    .expect("handle_image_file should succeed with existing AVIF sibling");

    assert_eq!(
        job.status,
        JobStatus::Skipped,
        "existing AVIF sibling should cause image job to be skipped"
    );
    assert_eq!(
        job.skip_reason.as_deref(),
        Some("Existing .avif sibling"),
        "skip reason should explain that an AVIF sibling already exists"
    );

    let preview = job.preview_path.as_deref().unwrap_or_default();
    assert!(
        preview.ends_with(".avif"),
        "preview_path should point to the existing AVIF sibling, got {preview}"
    );

    let output = job.output_path.as_deref().unwrap_or_default();
    assert!(
        output.ends_with(".avif"),
        "output_path should point to the existing AVIF sibling so the UI can display the compressed image path, got {output}"
    );

    let _ = fs::remove_file(&png);
    let _ = fs::remove_file(&avif);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn ensure_job_preview_regenerates_missing_preview_using_latest_percent() {
    if !ffmpeg_available() {
        eprintln!("skipping ensure_job_preview integration test because ffmpeg is not available");
        return;
    }

    let dir = env::temp_dir();
    let input = dir.join("ffui_it_preview_regen_in.mp4");

    if !generate_test_input_video(&input) {
        eprintln!(
            "skipping ensure_job_preview integration test because test input generation failed"
        );
        return;
    }

    let engine = make_engine_with_preset();
    let old_preview = build_preview_output_path(&input, 25);
    let new_percent = 50u8;

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        state.settings.preview_capture_percent = new_percent;

        let job = TranscodeJob {
            id: "job-1".to_string(),
            filename: input.to_string_lossy().into_owned(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status: JobStatus::Completed,
            progress: 100.0,
            start_time: None,
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: vec![],
            log_head: None,
            skip_reason: None,
            input_path: Some(input.to_string_lossy().into_owned()),
            output_path: None,
            output_policy: None,
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: Some(0.5),
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: None,
            }),
            estimated_seconds: None,
            preview_path: Some(old_preview.to_string_lossy().into_owned()),
            preview_revision: 7,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: None,
        };

        state.jobs.insert(job.id.clone(), job);
    }

    let regenerated = engine.ensure_job_preview("job-1");
    let expected_preview = build_preview_output_path(&input, new_percent);

    assert_eq!(
        regenerated.as_deref(),
        expected_preview.to_str(),
        "ensure_job_preview should return the preview path computed with the latest percent"
    );
    assert!(
        expected_preview.exists(),
        "regenerated preview file should exist on disk"
    );

    let state = engine.inner.state.lock().expect("engine state poisoned");
    let stored = state
        .jobs
        .get("job-1")
        .and_then(|j| j.preview_path.clone())
        .unwrap_or_default();
    assert_eq!(
        stored,
        expected_preview.to_string_lossy(),
        "job.preview_path should be updated in engine state"
    );
    let stored_rev = state
        .jobs
        .get("job-1")
        .map(|j| j.preview_revision)
        .unwrap_or_default();
    assert_eq!(
        stored_rev, 8,
        "job.preview_revision should bump when preview is regenerated"
    );

    let _ = fs::remove_file(&expected_preview);
    let _ = fs::remove_file(&input);
}

#[test]
fn refresh_video_previews_for_percent_updates_jobs_and_cleans_old_previews() {
    if !ffmpeg_available() {
        eprintln!("skipping preview refresh integration test because ffmpeg is not available");
        return;
    }

    let dir = env::temp_dir();
    let input = dir.join("ffui_it_preview_refresh_in.mp4");

    if !generate_test_input_video(&input) {
        eprintln!("skipping preview refresh integration test because test input generation failed");
        return;
    }

    let engine = make_engine_with_preset();
    let old_percent = 25u8;
    let new_percent = 50u8;
    let old_preview = build_preview_output_path(&input, old_percent);

    if let Some(parent) = old_preview.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&old_preview, b"old-preview-bytes")
        .expect("failed to create old preview placeholder");

    let refresh_token = 1u64;

    {
        let mut state = engine.inner.state.lock().expect("engine state poisoned");
        state.preview_refresh_token = refresh_token;
        state.settings.preview_capture_percent = new_percent;

        let job = TranscodeJob {
            id: "job-1".to_string(),
            filename: input.to_string_lossy().into_owned(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 1.0,
            original_codec: None,
            preset_id: "preset-1".to_string(),
            status: JobStatus::Completed,
            progress: 100.0,
            start_time: None,
            end_time: None,
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: None,
            logs: vec![],
            log_head: None,
            skip_reason: None,
            input_path: Some(input.to_string_lossy().into_owned()),
            output_path: None,
            output_policy: None,
            ffmpeg_command: None,
            media_info: Some(MediaInfo {
                duration_seconds: Some(0.5),
                width: None,
                height: None,
                frame_rate: None,
                video_codec: None,
                audio_codec: None,
                size_mb: None,
            }),
            estimated_seconds: None,
            preview_path: Some(old_preview.to_string_lossy().into_owned()),
            preview_revision: 2,
            log_tail: None,
            failure_reason: None,
            warnings: Vec::new(),
            batch_id: None,
            wait_metadata: None,
        };

        state.jobs.insert(job.id.clone(), job);
    }

    let tools = AppSettings::default().tools;
    engine.refresh_video_previews_for_percent(new_percent, refresh_token, tools);

    let expected_preview = build_preview_output_path(&input, new_percent);
    assert!(
        expected_preview.exists(),
        "refreshed preview file should exist on disk"
    );
    assert!(
        !old_preview.exists(),
        "old preview should be removed after refresh"
    );

    let state = engine.inner.state.lock().expect("engine state poisoned");
    let stored = state
        .jobs
        .get("job-1")
        .and_then(|j| j.preview_path.clone())
        .unwrap_or_default();
    assert_eq!(
        stored,
        expected_preview.to_string_lossy(),
        "job.preview_path should be updated to the new percent path"
    );
    let stored_rev = state
        .jobs
        .get("job-1")
        .map(|j| j.preview_revision)
        .unwrap_or_default();
    assert_eq!(
        stored_rev, 3,
        "job.preview_revision should bump when preview is refreshed"
    );

    let _ = fs::remove_file(&expected_preview);
    let _ = fs::remove_file(&input);
}
