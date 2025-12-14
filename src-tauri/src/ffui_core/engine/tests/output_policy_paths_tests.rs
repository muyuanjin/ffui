use super::*;
use crate::ffui_core::domain::{
    OutputContainerPolicy, OutputDirectoryPolicy, OutputFilenamePolicy, OutputPolicy,
};
use regex::Regex;

use super::super::output_policy_paths::{plan_output_path_with_extension, plan_video_output_path};

#[test]
fn plan_video_output_path_force_container_uses_correct_extension_and_muxer() {
    let mut preset = make_test_preset();
    preset.container = Some(ContainerConfig {
        format: Some("mp4".to_string()),
        movflags: None,
    });

    let input = PathBuf::from("C:/videos/sample.mp4");
    let policy = OutputPolicy {
        container: OutputContainerPolicy::Force {
            format: "mkv".to_string(),
        },
        ..OutputPolicy::default()
    };

    let plan = plan_video_output_path(&input, Some(&preset), &policy, |_| false);
    assert!(
        plan.output_path.to_string_lossy().ends_with(".mkv"),
        "force container mkv must produce .mkv extension, got: {}",
        plan.output_path.display()
    );
    assert_eq!(
        plan.forced_muxer.as_deref(),
        Some("matroska"),
        "mkv must map to matroska muxer for ffmpeg"
    );
}

#[test]
fn plan_video_output_path_appends_timestamp_without_touching_extension() {
    let input = PathBuf::from("C:/videos/video.mp4");
    let policy = OutputPolicy {
        filename: OutputFilenamePolicy {
            append_timestamp: true,
            ..OutputFilenamePolicy::default()
        },
        ..OutputPolicy::default()
    };

    let plan = plan_video_output_path(&input, None, &policy, |_| false);
    let name = plan
        .output_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    let re = Regex::new(r"^video\.compressed-\d{8}-\d{6}\.mp4$").expect("regex");
    assert!(
        re.is_match(name),
        "expected timestamped filename keeping extension, got: {name}"
    );
}

#[test]
fn plan_video_output_path_sanitizes_windows_reserved_device_names() {
    let input = PathBuf::from("C:/videos/CON.mp4");
    let policy = OutputPolicy::default();
    let plan = plan_video_output_path(&input, None, &policy, |_| false);
    let name = plan
        .output_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    assert!(
        name.starts_with("_CON"),
        "expected reserved device name to be prefixed with _, got: {name}"
    );
}

#[test]
fn plan_video_output_path_adds_counter_suffix_on_collision() {
    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("video.mp4");
    let policy = OutputPolicy::default();

    let first = plan_video_output_path(&input, None, &policy, |_| false).output_path;
    std::fs::create_dir_all(first.parent().unwrap_or(dir.path())).expect("create parent");
    std::fs::write(&first, b"existing").expect("write collision file");

    let second = plan_video_output_path(&input, None, &policy, |_| false).output_path;
    assert!(
        second
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .contains(" (1)."),
        "expected collision to use (1) suffix, got: {}",
        second.display()
    );
}

#[test]
fn plan_output_path_with_extension_preserves_custom_extension() {
    let input = PathBuf::from("C:/videos/audio.flac");
    let policy = OutputPolicy {
        directory: OutputDirectoryPolicy::Fixed {
            directory: "D:/out".to_string(),
        },
        filename: OutputFilenamePolicy {
            prefix: Some("PRE_".to_string()),
            suffix: Some("_SUF".to_string()),
            ..OutputFilenamePolicy::default()
        },
        ..OutputPolicy::default()
    };

    let out = plan_output_path_with_extension(&input, "m4a", None, &policy, |_| false);
    assert!(
        out.to_string_lossy().starts_with("D:/out"),
        "fixed directory must be used"
    );
    assert!(
        out.to_string_lossy().ends_with(".m4a"),
        "explicit extension must be used, got: {}",
        out.display()
    );
}
