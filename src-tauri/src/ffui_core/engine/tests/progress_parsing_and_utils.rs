use super::*;
#[test]
fn compute_preview_seek_seconds_uses_capture_percent_with_clamping() {
    // Normal case: 25% of a 200s clip -> 50s.
    let seek = compute_preview_seek_seconds(Some(200.0), 25);
    assert!(
        (seek - 50.0).abs() < 0.001,
        "expected seek around 50s for 25% of 200s, got {seek}"
    );

    // Very low percent clamps to at least 1s.
    let seek_low = compute_preview_seek_seconds(Some(200.0), 0);
    assert!(
        (seek_low - 1.0).abs() < 0.001,
        "seek should clamp to >= 1s when percent is 0, got {seek_low}"
    );

    // Very high percent clamps to at most duration - 1s.
    let seek_high = compute_preview_seek_seconds(Some(200.0), 100);
    assert!(
        (seek_high - 199.0).abs() < 0.001,
        "seek should clamp to <= duration-1s, expected ~199, got {seek_high}"
    );
}

#[test]
fn compute_preview_seek_seconds_falls_back_when_duration_unavailable() {
    let seek_none = compute_preview_seek_seconds(None, 25);
    assert!(
        (seek_none - 3.0).abs() < 0.001,
        "missing duration should fall back to default 3s, got {seek_none}"
    );

    let seek_zero = compute_preview_seek_seconds(Some(0.0), 25);
    assert!(
        (seek_zero - 3.0).abs() < 0.001,
        "zero duration should fall back to default 3s, got {seek_zero}"
    );
}

#[test]
fn compute_preview_seek_seconds_handles_very_short_clips() {
    // For very short clips we use a simple midpoint rather than 1..D-1.
    let seek_short = compute_preview_seek_seconds(Some(1.0), 25);
    assert!(
        (seek_short - 0.5).abs() < 0.001,
        "very short clips should use a midpoint (~0.5s for 1s clip), got {seek_short}"
    );
}

#[test]
fn parse_ffmpeg_time_to_seconds_handles_hms_with_fraction() {
    let v = parse_ffmpeg_time_to_seconds("00:01:29.95");
    assert!((v - 89.95).abs() < 0.001);
}

#[test]
fn parse_ffmpeg_duration_from_metadata_line_extracts_duration() {
    let line = "  Duration: 00:01:29.95, start: 0.000000, bitrate: 20814 kb/s";
    let seconds =
        parse_ffmpeg_duration_from_metadata_line(line).expect("duration should be parsed");
    assert!((seconds - 89.95).abs() < 0.001);

    let unrelated = "Some other log line without duration";
    assert!(parse_ffmpeg_duration_from_metadata_line(unrelated).is_none());
}

#[test]
fn parse_ffmpeg_progress_line_extracts_elapsed_and_speed() {
    let line = "frame=  899 fps=174 q=29.0 size=   12800KiB time=00:00:32.51 bitrate=3224.5kbits/s speed=6.29x elapsed=0:00:05.17";
    let (elapsed, speed) = parse_ffmpeg_progress_line(line).expect("progress should be parsed");
    assert!((elapsed - 32.51).abs() < 0.001);
    assert!((speed.unwrap() - 6.29).abs() < 0.001);
}

#[test]
fn parse_ffmpeg_progress_line_handles_out_time_and_out_time_ms() {
    // Simulate a minimal `-progress pipe:2` style block.
    let lines = ["frame=10", "out_time_ms=820000", "out_time=00:00:00.820000"];

    let mut last: Option<(f64, Option<f64>)> = None;
    for line in &lines {
        if let Some(sample) = parse_ffmpeg_progress_line(line) {
            last = Some(sample);
        }
    }

    let (elapsed, speed) = last.expect("structured progress should be parsed");
    assert!(
        (elapsed - 0.82).abs() < 0.001,
        "elapsed seconds should be derived from out_time, got {elapsed}"
    );
    assert!(
        speed.is_none(),
        "structured progress lines without an inline speed token should leave speed unset"
    );

    // Also accept a bare out_time_ms line when out_time is missing.
    let (elapsed_ms, _) =
        parse_ffmpeg_progress_line("out_time_ms=1234567").expect("ms-only progress should parse");
    assert!(
        (elapsed_ms - 1.234_567).abs() < 0.001,
        "out_time_ms (microseconds) should be converted to seconds, got {elapsed_ms}"
    );
}

#[test]
fn is_ffmpeg_progress_end_detects_end_marker() {
    assert!(!is_ffmpeg_progress_end("progress=continue"));
    assert!(is_ffmpeg_progress_end("progress=end"));
    assert!(is_ffmpeg_progress_end("   progress=END   "));
    assert!(!is_ffmpeg_progress_end(
        "some other line without progress token"
    ));
}

#[test]
fn parse_ffprobe_frame_rate_handles_fraction_and_integer() {
    let frac = parse_ffprobe_frame_rate("30000/1001")
        .expect("30000/1001 should parse as a valid frame rate");
    assert!((frac - 29.97).abs() < 0.01);

    let int = parse_ffprobe_frame_rate("24").expect("integer frame rate should parse");
    assert!((int - 24.0).abs() < f64::EPSILON);
}

#[test]
fn parse_ffprobe_frame_rate_rejects_invalid_or_empty_tokens() {
    assert!(parse_ffprobe_frame_rate("").is_none());
    assert!(parse_ffprobe_frame_rate("0/0").is_none());
    assert!(parse_ffprobe_frame_rate("not-a-number").is_none());
}

#[test]
fn compute_progress_percent_for_known_duration_uses_elapsed_ratio() {
    let total = Some(100.0);
    let samples = [
        (0.0, 0.0),
        (1.0, 1.0),
        (25.0, 25.0),
        (50.0, 50.0),
        (75.0, 75.0),
        (100.0, 100.0),
    ];
    for &(elapsed, expected) in &samples {
        let p = compute_progress_percent(total, elapsed);
        assert!(
            (p - expected).abs() < 0.001,
            "expected progress ~= {expected} for elapsed {elapsed}, got {p}"
        );
    }

    // Elapsed time beyond the nominal duration should not exceed 100%.
    let p_over = compute_progress_percent(total, 150.0);
    assert!(
        (p_over - 100.0).abs() < 0.001,
        "elapsed beyond duration should clamp to 100, got {p_over}"
    );
}

#[test]
fn compute_progress_percent_for_unknown_duration_returns_zero() {
    let samples = [0.0, 1.0, 5.0, 10.0, 30.0, 60.0, 120.0];
    for &t in &samples {
        let p = compute_progress_percent(None, t);
        assert!(
            (p - 0.0).abs() < f64::EPSILON,
            "unknown duration should not invent a fake percentage, expected 0, got {p}"
        );
    }
}
