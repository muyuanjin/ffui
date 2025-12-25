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

    let result =
        recompute_processed_seconds_from_segments(&mut meta, &settings, Some(89.951_995), 4.35);
    assert!(result.metadata_changed, "expected recompute to apply a correction");
    assert!(
        result.processed_seconds_changed,
        "expected processedSeconds to change"
    );
    assert_eq!(
        meta.segment_end_targets.as_deref(),
        Some(&[83.45][..]),
        "segment_end_targets must be synthesized so concat can clip the prior segment"
    );
    assert_eq!(meta.target_seconds, Some(83.45));
    assert_eq!(meta.processed_seconds, Some(83.45));
}

#[test]
fn recompute_processed_seconds_reports_alignment_fixes_even_when_processed_seconds_stays_stable() {
    let dir = tempfile::tempdir().expect("temp dir");
    let seg0 = dir.path().join("seg0.tmp.mkv");
    std::fs::write(&seg0, b"not-a-real-video").expect("write seg0");
    let missing = dir.path().join("missing.tmp.mkv");

    let settings = AppSettings::default();
    let mut meta = WaitMetadata {
        last_progress_percent: Some(12.5),
        processed_wall_millis: None,
        processed_seconds: Some(12.5),
        target_seconds: Some(12.5),
        last_progress_out_time_seconds: None,
        last_progress_frame: None,
        tmp_output_path: Some(seg0.to_string_lossy().into_owned()),
        segments: Some(vec![
            seg0.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]),
        segment_end_targets: Some(vec![12.5]),
    };

    let result = recompute_processed_seconds_from_segments(&mut meta, &settings, Some(90.0), 4.35);
    let expected_segments = vec![seg0.to_string_lossy().into_owned()];
    assert!(
        result.metadata_changed,
        "expected recompute to report metadata alignment changes"
    );
    assert!(
        !result.processed_seconds_changed,
        "processedSeconds should not be treated as materially changed"
    );
    assert_eq!(
        meta.segments.as_deref(),
        Some(expected_segments.as_slice()),
        "missing segment should be dropped so metadata stays aligned"
    );
    assert_eq!(
        meta.segment_end_targets.as_deref(),
        Some(&[12.5][..]),
        "segment_end_targets should remain aligned with the surviving segment"
    );
    assert_eq!(meta.target_seconds, Some(12.5));
    assert_eq!(meta.processed_seconds, Some(12.5));
}
