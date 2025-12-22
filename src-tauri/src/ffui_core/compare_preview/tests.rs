use std::fs;
use std::path::PathBuf;

use super::*;

#[test]
fn extract_frame_with_seek_backoffs_retries_when_tmp_output_is_missing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let tmp_path = dir.path().join("frame.part");
    let final_path = dir.path().join("frame.jpg");

    let mut calls = 0usize;
    let seek_used = extract_frame_with_seek_backoffs(
        10.0,
        &[0.0, 0.5],
        &tmp_path,
        &final_path,
        |_seek_seconds, out_path| {
            calls += 1;
            if calls == 2 {
                fs::write(out_path, b"jpeg").expect("write mock frame");
            }
            Ok(())
        },
    )
    .expect("expected fallback to succeed after retry");

    assert!(
        (seek_used - 9.5).abs() < 1e-9,
        "expected second attempt seek"
    );
    assert!(
        fs::metadata(&final_path)
            .map(|m| m.len() > 0)
            .unwrap_or(false),
        "final output should exist and be non-empty"
    );
    assert!(!tmp_path.exists(), "tmp output should be moved away");
}

#[test]
fn concat_preview_reports_missing_segments_with_os_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("missing-seg0.mp4");
    let present = dir.path().join("seg1.mp4");
    fs::write(&present, b"x").expect("write present segment");

    let segs = vec![
        missing.to_string_lossy().into_owned(),
        present.to_string_lossy().into_owned(),
    ];

    let err = extract_concat_preview_frame(
        &segs,
        &ExternalToolSettings::default(),
        0.0,
        FallbackFrameQuality::Low,
    )
    .expect_err("should fail for missing segments");

    let msg = err.to_string();
    assert!(
        msg.contains("segmentPaths contains a non-readable file:"),
        "should include a stable error prefix: {msg}"
    );
    assert!(
        msg.contains("missing-seg0.mp4"),
        "should include the path: {msg}"
    );
    assert!(
        msg.contains("os error"),
        "should include OS error details: {msg}"
    );
}

#[test]
fn concat_preview_ffmpeg_args_use_two_stage_seek_and_disable_audio() {
    let list_path = PathBuf::from("concat.list");
    let tmp_path = PathBuf::from("frame.part");

    let args_low =
        build_concat_ffmpeg_args(&list_path, 12.345, FallbackFrameQuality::Low, &tmp_path);
    let args_low: Vec<String> = args_low
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();

    let ss_indices: Vec<usize> = args_low
        .iter()
        .enumerate()
        .filter_map(|(i, v)| (v == "-ss").then_some(i))
        .collect();
    assert_eq!(ss_indices.len(), 2, "expected two -ss occurrences");

    let i_index = args_low
        .iter()
        .position(|v| v == "-i")
        .expect("expected -i arg");

    assert!(
        ss_indices[0] < i_index,
        "first -ss must be an input option before -i: {args_low:?}"
    );
    assert!(
        ss_indices[1] > i_index,
        "second -ss must be an output option after -i: {args_low:?}"
    );

    assert_eq!(
        args_low.get(ss_indices[0] + 1).map(String::as_str),
        Some("9.345")
    );
    assert_eq!(
        args_low.get(ss_indices[1] + 1).map(String::as_str),
        Some("3.000")
    );

    assert_eq!(
        args_low.get(i_index + 1).map(String::as_str),
        Some("concat.list"),
        "list path should follow -i"
    );
    assert!(
        args_low.iter().any(|v| v == "-an"),
        "concat previews should disable audio decoding: {args_low:?}"
    );
    assert!(
        args_low.iter().any(|v| v == "-vf"),
        "low-quality concat previews should apply a scale filter: {args_low:?}"
    );
    assert!(
        args_low.windows(2).any(|w| w == ["-q:v", "10"]),
        "low-quality concat previews should use a high q:v value: {args_low:?}"
    );
    assert!(
        args_low.windows(2).any(|w| w == ["-pix_fmt", "yuvj420p"]),
        "concat previews should force a full-range MJPEG pixel format: {args_low:?}"
    );
    assert!(
        args_low.windows(2).any(|w| w == ["-strict", "-1"]),
        "concat previews should relax strictness for MJPEG compatibility: {args_low:?}"
    );

    let args_high =
        build_concat_ffmpeg_args(&list_path, 1.0, FallbackFrameQuality::High, &tmp_path);
    let args_high: Vec<String> = args_high
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();
    assert!(
        args_high.windows(2).any(|w| w == ["-ss", "0.000"]),
        "fast seek should clamp to zero near the start: {args_high:?}"
    );
    assert!(
        args_high.windows(2).any(|w| w == ["-ss", "1.000"]),
        "accurate offset should match requested seconds near the start: {args_high:?}"
    );
    assert!(
        args_high
            .windows(2)
            .any(|w| w == ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]),
        "high-quality concat previews should round dimensions to even values: {args_high:?}"
    );
    assert!(
        args_high.windows(2).any(|w| w == ["-q:v", "3"]),
        "high-quality concat previews should use q:v=3: {args_high:?}"
    );
    assert!(
        args_high.windows(2).any(|w| w == ["-pix_fmt", "yuvj420p"]),
        "concat previews should force a full-range MJPEG pixel format: {args_high:?}"
    );
    assert!(
        args_high.windows(2).any(|w| w == ["-strict", "-1"]),
        "concat previews should relax strictness for MJPEG compatibility: {args_high:?}"
    );
}
