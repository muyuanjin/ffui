use super::*;

#[test]
fn derive_segment_end_targets_accumulates_durations() {
    let out = derive_segment_end_targets_from_durations(&[1.5, 2.0, 3.25]);
    assert_eq!(out.len(), 3);
    assert!((out[0] - 1.5).abs() < 1e-9);
    assert!((out[1] - 3.5).abs() < 1e-9);
    assert!((out[2] - 6.75).abs() < 1e-9);
}

#[test]
fn crash_recovery_rollback_rewinds_last_target_when_possible() {
    let mut targets = vec![5.0, 10.0];
    assert!(
        maybe_apply_crash_recovery_rollback(&mut targets, 3.0),
        "should apply rollback when last segment is long enough"
    );
    assert!((targets[0] - 5.0).abs() < 1e-9);
    assert!((targets[1] - 7.0).abs() < 1e-9);
}

#[test]
fn crash_recovery_rollback_skips_when_segment_is_too_short() {
    let mut targets = vec![5.0, 5.06];
    assert!(
        !maybe_apply_crash_recovery_rollback(&mut targets, 3.0),
        "should not apply rollback when it would cross the previous target"
    );
    assert!((targets[1] - 5.06).abs() < 1e-9);
}

#[test]
fn should_apply_crash_recovery_rollback_requires_empty_progress_fields() {
    let crash_like = WaitMetadata {
        last_progress_percent: None,
        processed_wall_millis: None,
        processed_seconds: None,
        target_seconds: None,
        tmp_output_path: Some("C:/tmp/seg0.tmp.mkv".to_string()),
        segments: Some(vec!["C:/tmp/seg0.tmp.mkv".to_string()]),
        segment_end_targets: None,
    };
    assert!(
        should_apply_crash_recovery_rollback(&crash_like),
        "should treat a job-start snapshot (no pause metadata) as crash-like"
    );

    let paused_like = WaitMetadata {
        last_progress_percent: Some(12.0),
        processed_wall_millis: Some(1234),
        processed_seconds: Some(12.0),
        target_seconds: Some(12.0),
        tmp_output_path: Some("C:/tmp/seg0.tmp.mkv".to_string()),
        segments: Some(vec!["C:/tmp/seg0.tmp.mkv".to_string()]),
        segment_end_targets: None,
    };
    assert!(
        !should_apply_crash_recovery_rollback(&paused_like),
        "should not apply crash rollback for paused jobs"
    );
}
