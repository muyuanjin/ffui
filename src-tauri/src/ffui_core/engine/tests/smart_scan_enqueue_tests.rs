use super::*;

#[test]
fn smart_scan_video_enqueue_keeps_batch_children_consecutive_even_when_manual_interleaves() {
    use crate::ffui_core::engine::smart_scan::video::enqueue_smart_scan_video_job;

    let dir = tempfile::tempdir().expect("temp dir must be created for enqueue test");
    let input1 = dir.path().join("batch_child_1.mp4");
    let input2 = dir.path().join("batch_child_2.mp4");
    let manual_input = dir.path().join("manual.mp4");

    for path in [&input1, &input2, &manual_input] {
        let mut file =
            File::create(path).unwrap_or_else(|_| panic!("create test file {}", path.display()));
        file.write_all(&[0u8; 1024])
            .unwrap_or_else(|_| panic!("write data for {}", path.display()));
    }

    let engine = make_engine_with_preset();
    let batch_id = "batch-1";

    let config = SmartScanConfig {
        min_video_size_mb: 0,
        video_preset_id: "preset-1".to_string(),
        ..Default::default()
    };

    let settings = engine.settings();
    let preset = engine
        .presets()
        .into_iter()
        .find(|p| p.id == "preset-1")
        .expect("test preset must exist");

    let job1 = enqueue_smart_scan_video_job(
        &engine.inner,
        &input1,
        &config,
        &settings,
        &preset,
        batch_id,
        false,
    );
    assert!(
        job1.ffmpeg_command
            .as_deref()
            .unwrap_or_default()
            .contains("ffmpeg"),
        "Smart Scan queued job should carry a planned ffmpeg command before processing"
    );

    let manual_job = engine.enqueue_transcode_job(
        manual_input.to_string_lossy().into_owned(),
        JobType::Video,
        JobSource::Manual,
        1.0,
        None,
        "preset-1".into(),
    );

    let job2 = enqueue_smart_scan_video_job(
        &engine.inner,
        &input2,
        &config,
        &settings,
        &preset,
        batch_id,
        false,
    );
    assert!(
        job2.ffmpeg_command
            .as_deref()
            .unwrap_or_default()
            .contains("libx264"),
        "Smart Scan queued job planned command should reflect the selected preset"
    );

    let state = engine.inner.state.lock().expect("engine state poisoned");
    let queue_vec: Vec<String> = state.queue.iter().cloned().collect();

    assert_eq!(
        queue_vec,
        vec![job1.id.clone(), job2.id.clone(), manual_job.id.clone()],
        "Smart Scan batch children should remain consecutive in waiting queue"
    );
}
