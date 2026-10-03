use super::*;

mod recovery;

#[test]
fn complete_command_input_contract_preserves_argv_and_reports_invalid_syntax() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../tests/ffmpeg-command-input-contract.json"
    ))
    .expect("command contract fixture");
    for case in contract["valid"].as_array().expect("valid cases") {
        let command = case["command"].as_str().expect("command");
        let expected: Vec<String> = serde_json::from_value(case["args"].clone()).expect("argv");
        assert_eq!(
            parse_ffmpeg_command(command).expect("parse"),
            expected,
            "{}",
            case["id"]
        );
    }
    for case in contract["invalid"].as_array().expect("invalid cases") {
        let error = parse_ffmpeg_command(case["command"].as_str().expect("command"))
            .expect_err("invalid syntax must fail");
        assert!(
            error.contains(case["error"].as_str().expect("error")),
            "{}: {error}",
            case["id"]
        );
    }
}

#[test]
fn advanced_preset_tokens_keep_literal_shell_characters() {
    assert_eq!(
        parse_command("-metadata title=a;b -metadata title=a&b").expect("preset"),
        ["-metadata", "title=a;b", "-metadata", "title=a&b"]
    );
    assert!(parse_ffmpeg_command("ffmpeg -metadata title=a;b").is_err());
}

#[test]
fn command_preserves_windows_paths_empty_arguments_and_filter_expressions() {
    let args = parse_command(
        r#"ffmpeg -i "C:\音乐\track.flac" -metadata "" -metadata title=INPUT -filter_complex "[0:a]volume=0.5[a]" -map "[a]" "D:\output\new.wav""#,
    ).expect("parse command");
    assert_eq!(
        args,
        vec![
            "-i",
            "C:\\音乐\\track.flac",
            "-metadata",
            "",
            "-metadata",
            "title=INPUT",
            "-filter_complex",
            "[0:a]volume=0.5[a]",
            "-map",
            "[a]",
            "D:\\output\\new.wav",
        ]
    );
}

#[test]
fn command_preserves_order_and_duplicate_options() {
    let args = parse_command("ffmpeg -f lavfi -i 'sine=frequency=440' -map 0 -map 0 -metadata title=one -metadata title=two -f null NUL")
        .expect("parse command");
    assert_eq!(
        args.iter()
            .filter(|argument| argument.as_str() == "-map")
            .count(),
        2
    );
    assert_eq!(
        &args[8..12],
        ["-metadata", "title=one", "-metadata", "title=two"]
    );
}

#[test]
fn command_rejects_unclosed_quotes() {
    assert!(parse_command("ffmpeg -i \"unfinished").is_err());
}

#[test]
fn pipe_rejection_does_not_reject_the_progress_channel() {
    let invocation = FfmpegInvocation {
        args: vec![
            "-progress".into(),
            "pipe:2".into(),
            "-f".into(),
            "null".into(),
            "NUL".into(),
        ],
        working_directory: None,
        progress: None,
        output: FfmpegOutput::Transparent,
    };
    assert!(validate_invocation(&invocation).is_ok());
}

#[test]
fn advanced_postfix_progress_and_persisted_invocations_keep_their_arguments() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("progress");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some("ffmpeg -i INPUT -progress pipe:2 OUTPUT".into());
    let JobExecution::Ffmpeg { invocation } = plan_manual_execution(
        Path::new("input.wav"),
        &preset,
        Path::new("output.wav"),
        &OutputPolicy::default(),
    )
    .expect("advanced postfix progress")
    .execution
    else {
        panic!("FFmpeg execution")
    };
    assert_eq!(
        invocation.args,
        ["-i", "input.wav", "-progress", "pipe:2", "output.wav"]
    );
    let restored: FfmpegInvocation =
        serde_json::from_value(serde_json::to_value(&invocation).expect("snapshot"))
            .expect("restore");
    assert!(validate_invocation(&restored).is_ok());
    assert_eq!(restored.args, invocation.args);
    assert_eq!(restored.working_directory, invocation.working_directory);
    assert_eq!(restored.output, invocation.output);
}

#[test]
fn invalid_configuration_does_not_fall_back_to_a_default_recipe() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("broken");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = None;
    assert!(
        plan_manual_execution(
            Path::new("input.wav"),
            &preset,
            Path::new("output.wav"),
            &OutputPolicy::default()
        )
        .is_err()
    );
    let invocation = FfmpegInvocation {
        args: vec!["-i".into(), "pipe:0".into()],
        working_directory: None,
        progress: None,
        output: FfmpegOutput::Transparent,
    };
    assert!(validate_invocation(&invocation).is_err());
}

#[test]
fn advanced_templates_only_bind_complete_tokens_and_keep_explicit_destinations() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("advanced");
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template =
        Some("ffmpeg -i INPUT -metadata title=INPUT -map 0 -map 0 -f null explicit-output".into());
    let execution = plan_manual_execution(
        Path::new("input.unknown"),
        &preset,
        Path::new("planned.wav"),
        &OutputPolicy::default(),
    )
    .expect("plan");
    assert!(execution.output_path.is_none());
    let JobExecution::Ffmpeg { invocation } = execution.execution else {
        panic!("expected command")
    };
    assert_eq!(invocation.args[1], "input.unknown");
    assert_eq!(invocation.args[3], "title=INPUT");
    assert_eq!(
        invocation.args.last().map(String::as_str),
        Some("explicit-output")
    );
    assert!(invocation.working_directory.is_none());
    assert_eq!(invocation.output, FfmpegOutput::Transparent);
}

#[test]
fn literal_percent_paths_are_not_mistaken_for_image_sequences() {
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("image");
    preset.container = Some(crate::ffui_core::domain::ContainerConfig {
        format: Some("png".into()),
        movflags: None,
    });
    for output in [
        "100% complete.png",
        "frame%%d.png",
        "frame%%03d.png",
        "frame%%%%d.png",
    ] {
        assert!(
            plan_manual_execution(
                Path::new("input.png"),
                &preset,
                Path::new(output),
                &OutputPolicy::default()
            )
            .is_ok(),
            "{output}"
        );
    }
    for output in [
        "frame%d.png",
        "frame%03d.png",
        "frame%%%03d.png",
        "frame%%%%%d.png",
    ] {
        assert!(
            plan_manual_execution(
                Path::new("input.png"),
                &preset,
                Path::new(output),
                &OutputPolicy::default()
            )
            .is_err(),
            "{output}"
        );
    }
}

#[test]
fn managed_output_uses_effective_muxer_instead_of_raw_preset_text() {
    use crate::ffui_core::domain::{ContainerConfig, OutputContainerPolicy};
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("muxer");
    for format in [" DASH ", " HLS ", " m3u8 ", " mpd ", " SEGMENT "] {
        preset.container = Some(ContainerConfig {
            format: Some(format.into()),
            movflags: None,
        });
        assert!(
            plan_manual_execution(
                Path::new("in.wav"),
                &preset,
                Path::new("out.wav"),
                &OutputPolicy::default()
            )
            .is_err(),
            "{format}"
        );
        let policy = OutputPolicy {
            container: OutputContainerPolicy::Force {
                format: "wav".into(),
            },
            ..Default::default()
        };
        let JobExecution::Ffmpeg { invocation } =
            plan_manual_execution(Path::new("in.wav"), &preset, Path::new("out.wav"), &policy)
                .expect("single-file policy overrides multi-file preset")
                .execution
        else {
            panic!("managed recipe")
        };
        assert!(invocation.args.windows(2).any(|pair| pair == ["-f", "wav"]));
    }
    preset.container = None;
    for output in ["out.m3u8", "out.mpd"] {
        assert!(
            plan_manual_execution(
                Path::new("in.wav"),
                &preset,
                Path::new(output),
                &OutputPolicy::default()
            )
            .is_err()
        );
    }
}

#[test]
fn video_ownership_rejects_multi_file_muxers_before_granting_replay() {
    use crate::ffui_core::domain::{ContainerConfig, OutputContainerPolicy};
    let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("video");
    for format in [
        " HLS ",
        " DASH ",
        "m3u8",
        "mpd",
        "segment",
        "stream_segment",
        "ssegment",
        "tee",
        "webm_chunk",
        "smoothstreaming",
        " HDS ",
    ] {
        preset.container = Some(ContainerConfig {
            format: Some(format.into()),
            movflags: None,
        });
        let error = plan_manual_execution(
            Path::new("input.mp4"),
            &preset,
            Path::new("output.mp4"),
            &OutputPolicy::default(),
        )
        .err()
        .expect("multi-file recipe");
        assert!(error.contains("Multi-file"), "{format}: {error}");
        let policy = OutputPolicy {
            container: OutputContainerPolicy::Force {
                format: "mp4".into(),
            },
            ..Default::default()
        };
        let plan = plan_manual_execution(
            Path::new("input.mp4"),
            &preset,
            Path::new("output.mp4"),
            &policy,
        )
        .expect("single-file override");
        assert!(matches!(plan.execution, JobExecution::Video { .. }));
    }
    preset.container = None;
    for format in ["hls", "dash", "hds", "image2"] {
        let policy = OutputPolicy {
            container: OutputContainerPolicy::Force {
                format: format.into(),
            },
            ..Default::default()
        };
        assert!(
            plan_manual_execution(
                Path::new("input.mp4"),
                &preset,
                Path::new("frame%03d.png"),
                &policy,
            )
            .is_err()
        );
    }
    let policy = OutputPolicy {
        container: OutputContainerPolicy::Force {
            format: "png".into(),
        },
        ..Default::default()
    };
    assert!(
        plan_manual_execution(
            Path::new("input.mp4"),
            &preset,
            Path::new("100% complete.png"),
            &policy,
        )
        .is_ok()
    );
    preset.advanced_enabled = Some(true);
    for muxer in ["hls", "hds"] {
        preset.ffmpeg_template = Some(format!("ffmpeg -i INPUT -f {muxer} OUTPUT"));
        let plan = plan_manual_execution(
            Path::new("input.mp4"),
            &preset,
            Path::new("output.m3u8"),
            &OutputPolicy::default(),
        )
        .expect("transparent multi-file recipe");
        assert!(matches!(plan.execution, JobExecution::Ffmpeg { invocation }
            if invocation.output == FfmpegOutput::Transparent));
    }
}

#[test]
fn managed_relative_paths_bind_to_the_enqueue_directory() {
    let preset = crate::test_support::make_ffmpeg_preset_for_tests("paths");
    let JobExecution::Ffmpeg { invocation } = plan_manual_execution(
        Path::new("input.wav"),
        &preset,
        Path::new("output.wav"),
        &OutputPolicy::default(),
    )
    .expect("plan")
    .execution
    else {
        panic!("managed recipe")
    };
    let input = std::path::absolute("input.wav").expect("input");
    assert!(
        invocation
            .args
            .iter()
            .any(|argument| Path::new(argument) == input)
    );
    let FfmpegOutput::ManagedFile { path, .. } = invocation.output else {
        panic!("managed output")
    };
    assert_eq!(
        Path::new(&path),
        std::path::absolute("output.wav").expect("output")
    );
    assert!(
        invocation
            .working_directory
            .is_some_and(|directory| Path::new(&directory).is_absolute())
    );
}
