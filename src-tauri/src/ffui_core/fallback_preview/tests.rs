use super::*;
use filetime::{FileTime, set_file_mtime};
use std::time::Duration;

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
        "s1000"
    );
    assert_eq!(
        bucket_position(
            FallbackFramePosition::Seconds(1.2),
            FallbackFrameQuality::High
        ),
        "s1000"
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

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let old_time = FileTime::from_unix_time(now - 10_000, 0);
    let new_time = FileTime::from_unix_time(now, 0);
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
