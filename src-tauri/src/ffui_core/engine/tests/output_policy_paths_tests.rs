use regex::Regex;

use super::super::output_policy_paths::{
    plan_output_path_with_extension, plan_video_output_path, preview_video_output_path,
};
use super::*;
use crate::ffui_core::domain::{
    OutputContainerPolicy, OutputDirectoryPolicy, OutputFilenameAppend, OutputFilenamePolicy,
    OutputPolicy,
};

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
fn plan_video_output_path_force_ts_and_m2ts_preserve_extension_and_use_mpegts_muxer() {
    let input = PathBuf::from("C:/videos/sample.mp4");

    for fmt in ["ts", "m2ts"] {
        let policy = OutputPolicy {
            container: OutputContainerPolicy::Force {
                format: fmt.to_string(),
            },
            ..OutputPolicy::default()
        };

        let plan = plan_video_output_path(&input, None, &policy, |_| false);
        assert!(
            plan.output_path
                .to_string_lossy()
                .ends_with(&format!(".{fmt}")),
            "force container {fmt} must preserve extension, got: {}",
            plan.output_path.display()
        );
        assert_eq!(
            plan.forced_muxer.as_deref(),
            Some("mpegts"),
            "{fmt} must map to mpegts muxer for ffmpeg"
        );
        assert!(plan.warnings.is_empty(), "no warnings expected for {fmt}");
    }
}

#[test]
fn plan_video_output_path_force_wmv_uses_asf_muxer_and_wmv_extension() {
    let input = PathBuf::from("C:/videos/sample.mp4");
    let policy = OutputPolicy {
        container: OutputContainerPolicy::Force {
            format: "wmv".to_string(),
        },
        ..OutputPolicy::default()
    };

    let plan = plan_video_output_path(&input, None, &policy, |_| false);
    assert!(
        plan.output_path.to_string_lossy().ends_with(".wmv"),
        "force container wmv must produce .wmv extension, got: {}",
        plan.output_path.display()
    );
    assert_eq!(
        plan.forced_muxer.as_deref(),
        Some("asf"),
        "wmv must map to asf muxer for ffmpeg"
    );
    assert!(plan.warnings.is_empty(), "no warnings expected for wmv");
}

#[test]
fn plan_video_output_path_force_webm_falls_back_to_mkv_when_incompatible() {
    let mut preset = make_test_preset();
    preset.video.encoder = EncoderType::HevcNvenc;
    preset.audio.codec = crate::ffui_core::domain::AudioCodecType::Copy;

    let input = PathBuf::from("C:/videos/sample.mp4");
    let policy = OutputPolicy {
        container: OutputContainerPolicy::Force {
            format: "webm".to_string(),
        },
        ..OutputPolicy::default()
    };

    let plan = plan_video_output_path(&input, Some(&preset), &policy, |_| false);
    assert!(
        plan.output_path.to_string_lossy().ends_with(".mkv"),
        "incompatible forced webm must fall back to .mkv, got: {}",
        plan.output_path.display()
    );
    assert_eq!(
        plan.forced_muxer.as_deref(),
        Some("matroska"),
        "fallback container must use matroska muxer"
    );
    assert!(
        plan.warnings
            .iter()
            .any(|w| w.code == "forcedContainerFallback"),
        "expected forcedContainerFallback warning"
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
fn preview_video_output_path_does_not_probe_filesystem_for_collisions() {
    let dir = tempfile::tempdir().expect("tempdir");
    let input = dir.path().join("video.mp4");
    let policy = OutputPolicy::default();

    let planned = plan_video_output_path(&input, None, &policy, |_| false).output_path;
    std::fs::create_dir_all(planned.parent().unwrap_or(dir.path())).expect("create parent");
    std::fs::write(&planned, b"existing").expect("write collision file");

    let preview = preview_video_output_path(&input, None, &policy).output_path;
    assert_eq!(
        preview, planned,
        "preview should not auto-increment based on existing files"
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

#[test]
fn plan_video_output_path_respects_append_order_for_suffix_timestamp_random() {
    let input = PathBuf::from("C:/videos/video.mp4");
    let policy = OutputPolicy {
        filename: OutputFilenamePolicy {
            suffix: Some(".compressed".to_string()),
            append_timestamp: true,
            random_suffix_len: Some(6),
            append_order: vec![
                OutputFilenameAppend::Random,
                OutputFilenameAppend::Suffix,
                OutputFilenameAppend::Timestamp,
            ],
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

    // Expect: video-<rand>.compressed-<timestamp>.mp4 (order: random -> suffix -> timestamp).
    let re = Regex::new(r"^video-[0-9a-f]{6}\.compressed-\d{8}-\d{6}\.mp4$").expect("regex");
    assert!(re.is_match(name), "unexpected append order output: {name}");
}
