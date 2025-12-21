use super::*;

#[test]
fn choose_processed_seconds_prefers_probed_when_progress_is_far_ahead() {
    let chosen = choose_processed_seconds_after_wait(Some(100.0), Some(10.5), Some(10.0));
    assert!(
        (chosen.unwrap_or(0.0) - 10.0).abs() < 0.000_001,
        "should ignore a progress timestamp that is materially ahead (likely non-video tail)"
    );
}

#[test]
fn choose_processed_seconds_uses_max_when_progress_is_close() {
    let chosen = choose_processed_seconds_after_wait(Some(100.0), Some(10.05), Some(10.0));
    assert!(
        (chosen.unwrap_or(0.0) - 10.05).abs() < 0.000_001,
        "should keep the larger timestamp when the delta is within tolerance"
    );
}

#[test]
fn choose_processed_seconds_prefers_probed_when_progress_lags() {
    let chosen = choose_processed_seconds_after_wait(Some(100.0), Some(9.9), Some(10.0));
    assert!(
        (chosen.unwrap_or(0.0) - 10.0).abs() < 0.000_001,
        "should prefer probed end when progress lags behind actual muxed frames"
    );
}

#[test]
fn choose_processed_seconds_clamps_to_media_duration() {
    let chosen = choose_processed_seconds_after_wait(Some(10.0), Some(12.0), Some(12.0));
    assert!(
        (chosen.unwrap_or(0.0) - 10.0).abs() < 0.000_001,
        "returned processed seconds should clamp to media duration"
    );
}
