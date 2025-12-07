use super::*;
#[test]
fn build_preview_output_path_is_stable_for_same_input() {
    let dir = env::temp_dir();
    let path = dir.join("preview_target.mp4");

    let first = build_preview_output_path(&path);
    let second = build_preview_output_path(&path);

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

    let config = SmartScanConfig {
        min_image_size_kb: 1,      // treat the tiny PNG as a valid candidate
        min_video_size_mb: 10_000, // unused here
        min_saving_ratio: 0.95,
        image_target_format: ImageTargetFormat::Avif,
        video_preset_id: "preset-1".to_string(),
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
