use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use filetime::{FileTime, set_file_mtime};

use super::*;
use crate::ffui_core::preview_common::{
    ensure_dir_exists, extract_frame_with_seek_backoffs, frame_tmp_filename,
};

#[test]
fn clamp_seek_seconds_never_exceeds_duration() {
    assert_eq!(clamp_seek_seconds(Some(10.0), -1.0), 0.0);
    let clamped = clamp_seek_seconds(Some(10.0), 999.0);
    assert!(clamped <= 10.0);
    assert!(clamped >= 0.0);
}

#[test]
fn bucket_position_is_stable() {
    assert_eq!(
        bucket_position(
            FallbackFramePosition::Percent(9.9),
            FallbackFrameQuality::Low
        ),
        "p010"
    );
    assert_eq!(
        bucket_position(
            FallbackFramePosition::Percent(9.9),
            FallbackFrameQuality::High
        ),
        "p010"
    );
    assert_eq!(
        bucket_position(
            FallbackFramePosition::Seconds(1.2),
            FallbackFrameQuality::Low
        ),
        "s1200"
    );
    assert_eq!(
        bucket_position(
            FallbackFramePosition::Seconds(1.2),
            FallbackFrameQuality::High
        ),
        "s1200"
    );
}

#[test]
fn cleanup_enforces_ttl_and_size() {
    let dir = tempfile::tempdir().expect("tempdir");
    let cache_root = dir.path().join("fallback-cache");
    let frames = cache_root.join("frames");
    fs::create_dir_all(&frames).unwrap();

    let old = frames.join("old.jpg");
    let new = frames.join("new.jpg");
    fs::write(&old, vec![0u8; 10]).unwrap();
    fs::write(&new, vec![0u8; 10]).unwrap();

    let now_unix_seconds = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let now_unix_seconds =
        i64::try_from(now_unix_seconds).expect("unix timestamp must fit within i64");
    let old_time = FileTime::from_unix_time(now_unix_seconds - 10_000, 0);
    let new_time = FileTime::from_unix_time(now_unix_seconds, 0);
    set_file_mtime(&old, old_time).unwrap();
    set_file_mtime(&new, new_time).unwrap();

    cache::cleanup_fallback_cache(&cache_root, 100, Some(Duration::from_secs(1))).unwrap();
    assert!(!old.exists(), "ttl should remove old entry");
    assert!(new.exists(), "new entry should remain");

    cache::cleanup_fallback_cache(&cache_root, 0, None).unwrap();
    assert!(!new.exists(), "size cap should evict remaining entries");
}

#[test]
fn ffmpeg_filtergraphs_are_legacy_compatible() {
    assert_eq!(LOW_QUALITY_FRAME_VF, "scale=-2:360");
    assert!(!LOW_QUALITY_FRAME_VF.contains("force_original_aspect_ratio"));
}

#[test]
fn ffmpeg_frame_extraction_args_force_full_range_mjpeg_and_even_dimensions() {
    let source = PathBuf::from("C:/videos/source.mp4");
    let tmp = PathBuf::from("C:/tmp/frame.part");

    let low =
        build_fallback_ffmpeg_args(&source, "1.000", "0.500", FallbackFrameQuality::Low, &tmp);
    let low: Vec<String> = low
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();
    assert!(
        low.windows(2).any(|w| w == ["-pix_fmt", "yuvj420p"]),
        "fallback frames should force a full-range MJPEG pixel format: {low:?}"
    );
    assert!(
        low.windows(2).any(|w| w == ["-strict", "-1"]),
        "fallback frames should relax strictness for MJPEG compatibility: {low:?}"
    );

    let high =
        build_fallback_ffmpeg_args(&source, "1.000", "0.500", FallbackFrameQuality::High, &tmp);
    let high: Vec<String> = high
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();
    assert!(
        high.windows(2)
            .any(|w| w == ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]),
        "high-quality fallback frames should round dimensions to even values: {high:?}"
    );
    assert!(
        high.windows(2).any(|w| w == ["-pix_fmt", "yuvj420p"]),
        "fallback frames should force a full-range MJPEG pixel format: {high:?}"
    );
    assert!(
        high.windows(2).any(|w| w == ["-strict", "-1"]),
        "fallback frames should relax strictness for MJPEG compatibility: {high:?}"
    );
}

#[test]
fn ffmpeg_tmp_outputs_use_part_extension() {
    assert!(frame_tmp_filename(1).ends_with(".part"));
}

#[test]
fn ensure_dir_exists_creates_directory() {
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("a").join("b").join("c");
    assert!(!nested.exists());
    ensure_dir_exists(&nested).expect("ensure_dir_exists should create nested dirs");
    assert!(nested.is_dir());
}

#[test]
fn extract_fallback_frame_reports_source_path_and_os_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("missing-input.mp4");
    assert!(!missing.exists());
    let missing_str = missing.to_string_lossy().into_owned();

    let err = extract_fallback_frame(
        &missing_str,
        &ExternalToolSettings::default(),
        None,
        FallbackFramePosition::Seconds(0.0),
        FallbackFrameQuality::Low,
    )
    .expect_err("should fail for missing source path");

    let msg = err.to_string();
    assert!(
        msg.contains("sourcePath is not a readable file:"),
        "should include a stable error prefix: {msg}"
    );
    assert!(
        msg.contains(&missing_str),
        "should include the source path: {msg}"
    );
    assert!(
        msg.contains("os error"),
        "should include OS error details: {msg}"
    );
}

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
        "ffmpeg did not produce a preview frame output",
        |seek_seconds, out_path| {
            calls += 1;
            if calls == 2 {
                fs::write(out_path, b"jpeg").expect("write mock frame");
            }
            // Simulate a "success" exit status even when no output was written.
            let _ = seek_seconds;
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
fn extract_frame_with_seek_backoffs_errors_when_no_attempt_writes_output() {
    let dir = tempfile::tempdir().expect("tempdir");
    let tmp_path = dir.path().join("frame.part");
    let final_path = dir.path().join("frame.jpg");

    let err = extract_frame_with_seek_backoffs(
        1.0,
        &[0.0, 0.5],
        &tmp_path,
        &final_path,
        "ffmpeg did not produce a preview frame output",
        |_seek_seconds, _out_path| Ok(()),
    )
    .expect_err("should fail when no tmp output is produced");

    let msg = err.to_string();
    assert!(
        msg.contains("wrote no frame output") || msg.contains("did not produce"),
        "should surface a stable error message: {msg}"
    );
    assert!(!final_path.exists(), "final output should not be created");
}
