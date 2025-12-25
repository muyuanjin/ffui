use super::*;

#[test]
fn recompute_processed_seconds_synthesizes_segment_end_targets_from_last_progress_out_time() {
    let dir = tempfile::tempdir().expect("temp dir");
    let seg0 = dir.path().join("seg0.tmp.mkv");
    std::fs::write(&seg0, b"not-a-real-video").expect("write seg0");

    let settings = AppSettings::default();
    let mut meta = WaitMetadata {
        last_progress_percent: Some(92.77),
        processed_wall_millis: None,
        processed_seconds: None,
        target_seconds: None,
        last_progress_out_time_seconds: Some(83.45),
        last_progress_frame: Some(2305),
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![seg0.to_string_lossy().into_owned()]),
        segment_end_targets: None,
    };

    let corrected =
        recompute_processed_seconds_from_segments(&mut meta, &settings, Some(89.951_995), 4.35);
    assert!(corrected, "expected recompute to apply a correction");
    assert_eq!(
        meta.segment_end_targets.as_deref(),
        Some(&[83.45]),
        "segment_end_targets must be synthesized so concat can clip the prior segment"
    );
    assert_eq!(meta.target_seconds, Some(83.45));
    assert_eq!(meta.processed_seconds, Some(83.45));
}

