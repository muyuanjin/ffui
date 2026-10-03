use super::*;
use crate::ffui_core::domain::{OutputContainerPolicy, OutputPolicy};

#[test]
fn webm_media_policy_previews_match_compatible_templates_and_structured_fallback() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tests/output-media-policy-contract.json"
    ))
    .expect("media output contract");
    let policy = OutputPolicy {
        container: OutputContainerPolicy::ByMedia {
            video: Some("webm".into()),
            audio: Some("mp3".into()),
            image: None,
        },
        ..OutputPolicy::default()
    };
    for case in fixture["webmCases"].as_array().expect("WebM cases") {
        let input = Path::new(case["input"].as_str().expect("input"));
        let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("webm");
        preset.video.encoder = serde_json::from_value(case["videoCodec"].clone()).expect("encoder");
        preset.audio.codec =
            serde_json::from_value(case["audioCodec"].clone()).expect("audio codec");
        preset.advanced_enabled = Some(case["template"].is_string());
        preset.ffmpeg_template = case["template"].as_str().map(str::to_string);
        preset.output_kind = case
            .get("declared")
            .map(|kind| serde_json::from_value(kind.clone()).expect("declared output"));
        let plan = super::super::output_policy_paths::preview_video_output_path(
            input,
            Some(&preset),
            &policy,
        );
        assert_eq!(
            plan.output_path
                .extension()
                .and_then(|extension| extension.to_str()),
            case["extension"].as_str()
        );
        assert_eq!(
            plan.forced_muxer.as_deref(),
            Some(if case["extension"] == "mkv" {
                "matroska"
            } else {
                "webm"
            })
        );
    }
}

#[test]
fn media_output_policy_paths_and_execution_share_the_wire_contract() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tests/output-media-policy-contract.json"
    ))
    .expect("media output contract");
    let container: OutputContainerPolicy =
        serde_json::from_value(fixture["container"].clone()).expect("policy IPC");
    let policy = OutputPolicy {
        container,
        ..OutputPolicy::default()
    };
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("scoped-output");
    preset.container = Some(crate::ffui_core::domain::ContainerConfig {
        format: Some("mp4".into()),
        movflags: None,
    });
    for case in fixture["cases"].as_array().expect("cases") {
        let input = PathBuf::from(case["input"].as_str().expect("input").replace('\\', "/"));
        let kind = super::super::manual_execution::presentation_type(&input);
        assert_eq!(serde_json::to_value(kind).expect("type wire"), case["type"]);
        let plan = super::super::output_policy_paths::preview_video_output_path(
            &input,
            Some(&preset),
            &policy,
        );
        assert_eq!(
            plan.output_path
                .extension()
                .and_then(|extension| extension.to_str()),
            case["extension"].as_str()
        );
        assert_eq!(plan.forced_muxer.as_deref(), case["muxer"].as_str());
        let args = super::super::ffmpeg_args::build_ffmpeg_args(
            &preset,
            &input,
            &plan.output_path,
            false,
            Some(&policy),
        );
        let expected_muxer = case["muxer"].as_str().unwrap_or("mp4");
        assert!(
            args.windows(2).any(|pair| pair == ["-f", expected_muxer]),
            "{args:?}"
        );
    }
}

#[test]
fn audio_format_does_not_override_video_recipe_or_webm_compatibility() {
    let input = Path::new("video.mp4");
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("video");
    preset.container = Some(crate::ffui_core::domain::ContainerConfig {
        format: Some("mp4".into()),
        movflags: None,
    });
    let policy = OutputPolicy {
        container: OutputContainerPolicy::ByMedia {
            video: None,
            audio: Some("mp3".into()),
            image: None,
        },
        ..OutputPolicy::default()
    };
    let output =
        super::super::output_policy_paths::preview_video_output_path(input, Some(&preset), &policy);
    assert_eq!(
        output
            .output_path
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("mp4")
    );
    let args = super::super::ffmpeg_args::build_ffmpeg_args(
        &preset,
        input,
        &output.output_path,
        false,
        Some(&policy),
    );
    assert!(!args.contains(&"mp3".to_string()));
    assert!(args.windows(2).any(|pair| pair == ["-c:v", "libx264"]));
    let policy = OutputPolicy {
        container: OutputContainerPolicy::ByMedia {
            video: Some("webm".into()),
            audio: Some("mp3".into()),
            image: None,
        },
        ..policy
    };
    let output =
        super::super::output_policy_paths::preview_video_output_path(input, Some(&preset), &policy);
    assert_eq!(output.forced_muxer.as_deref(), Some("matroska"));
    assert_eq!(output.warnings.len(), 1);
    let args = super::super::ffmpeg_args::build_ffmpeg_args(
        &preset,
        input,
        &output.output_path,
        false,
        Some(&policy),
    );
    assert!(args.windows(2).any(|pair| pair == ["-f", "matroska"]));
}
