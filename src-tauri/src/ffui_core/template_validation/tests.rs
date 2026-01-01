use super::template_validation_sample_mp4::SAMPLE_MP4_BYTES;
use super::{PresetTemplateValidationOutcome, validate_preset_template_with_program};

use crate::ffui_core::domain::FFmpegPreset;

fn locate_mock_ffmpeg_exe() -> std::path::PathBuf {
    fn is_mock_ffmpeg_exe(path: &std::path::Path) -> bool {
        if !path.is_file() {
            return false;
        }
        if cfg!(windows) {
            return path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
        }
        path.extension().is_none()
    }

    fn find_in_dir(dir: &std::path::Path) -> Option<std::path::PathBuf> {
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let mut matches: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
            })
            .filter(|p| is_mock_ffmpeg_exe(p))
            .collect();
        matches.sort();
        matches.into_iter().next()
    }

    for key in [
        "CARGO_BIN_EXE_ffui-mock-ffmpeg",
        "CARGO_BIN_EXE_ffui_mock_ffmpeg",
    ] {
        if let Ok(path) = std::env::var(key)
            && !path.trim().is_empty()
        {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return p;
            }
        }
    }

    if let Ok(current) = std::env::current_exe()
        && let Some(dir) = current.parent()
        && let Some(found) = find_in_dir(dir)
    {
        return found;
    }

    let crate_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_root = crate_root.join("target");
    let direct_candidates = if cfg!(windows) {
        ["ffui-mock-ffmpeg.exe", "ffui_mock_ffmpeg.exe"]
    } else {
        ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"]
    };

    for profile in ["check-all", "debug", "release"] {
        for exe_name in direct_candidates {
            let direct = target_root.join(profile).join(exe_name);
            if direct.exists() {
                return direct;
            }
        }

        let deps_dir = target_root.join(profile).join("deps");
        if deps_dir.exists()
            && let Some(found) = find_in_dir(&deps_dir)
        {
            return found;
        }
    }

    panic!("unable to locate mock ffmpeg executable (ffui_mock_ffmpeg)");
}

fn make_preset(template: &str) -> FFmpegPreset {
    use crate::ffui_core::domain::{AudioCodecType, EncoderType, RateControlMode};
    FFmpegPreset {
        id: "p".to_string(),
        name: "p".to_string(),
        description: "".to_string(),
        description_i18n: None,
        global: None,
        input: None,
        mapping: None,
        video: crate::ffui_core::domain::VideoConfig {
            encoder: EncoderType::Libx264,
            rate_control: RateControlMode::Crf,
            quality_value: 23,
            preset: "medium".to_string(),
            tune: None,
            profile: None,
            bitrate_kbps: None,
            max_bitrate_kbps: None,
            buffer_size_kbits: None,
            pass: None,
            level: None,
            gop_size: None,
            bf: None,
            pix_fmt: None,
            b_ref_mode: None,
            rc_lookahead: None,
            spatial_aq: None,
            temporal_aq: None,
        },
        audio: crate::ffui_core::domain::AudioConfig {
            codec: AudioCodecType::Copy,
            bitrate: None,
            sample_rate_hz: None,
            channels: None,
            channel_layout: None,
            loudness_profile: None,
            target_lufs: None,
            loudness_range: None,
            true_peak_db: None,
        },
        filters: crate::ffui_core::domain::FilterConfig {
            scale: None,
            crop: None,
            fps: None,
            vf_chain: None,
            af_chain: None,
            filter_complex: None,
        },
        subtitles: None,
        container: None,
        hardware: None,
        stats: crate::ffui_core::domain::PresetStats {
            usage_count: 0,
            total_input_size_mb: 0.0,
            total_output_size_mb: 0.0,
            total_time_seconds: 0.0,
            total_frames: 0.0,
            vmaf_count: 0,
            vmaf_sum: 0.0,
            vmaf_min: 0.0,
            vmaf_max: 0.0,
        },
        advanced_enabled: Some(true),
        ffmpeg_template: Some(template.to_string()),
        is_smart_preset: None,
    }
}

#[test]
fn bundled_sample_mp4_contains_required_atoms() {
    let bytes = SAMPLE_MP4_BYTES.as_slice();
    assert!(bytes.len() >= 128, "sample mp4 is unexpectedly small");
    assert!(
        bytes.windows(4).any(|w| w == b"ftyp"),
        "sample mp4 missing ftyp"
    );
    assert!(
        bytes.windows(4).any(|w| w == b"moov"),
        "sample mp4 missing moov"
    );
}

#[test]
fn template_invalid_when_missing_placeholders() {
    let preset = make_preset("ffmpeg -i INPUT -c:v libx264 OUTPUT.mp4");
    let out =
        validate_preset_template_with_program(&preset, "ffmpeg", Some("path".to_string()), None);
    assert_eq!(
        out.outcome,
        PresetTemplateValidationOutcome::TemplateInvalid
    );
}

#[test]
fn skipped_when_tool_missing() {
    let preset = make_preset("ffmpeg -i INPUT -c:v libx264 OUTPUT");
    let out = validate_preset_template_with_program(
        &preset,
        "ffui_definitely_missing_ffmpeg_binary_xyz",
        Some("custom".to_string()),
        None,
    );
    assert_eq!(
        out.outcome,
        PresetTemplateValidationOutcome::SkippedToolUnavailable
    );
}

#[test]
fn success_path_with_mock_ffmpeg() {
    let _env_lock = crate::test_support::env_lock();
    let _guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EMIT_PROGRESS",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EMIT_PROGRESS", "0");

    let mock_exe = locate_mock_ffmpeg_exe();
    let preset = make_preset("ffmpeg -hide_banner -i INPUT -c:v libx264 -c:a copy OUTPUT");
    let out = validate_preset_template_with_program(
        &preset,
        mock_exe.to_string_lossy().as_ref(),
        Some("custom".to_string()),
        Some(2_000),
    );
    assert_eq!(out.outcome, PresetTemplateValidationOutcome::Ok);
}

#[test]
fn times_out_and_is_terminated() {
    let _env_lock = crate::test_support::env_lock();
    let _guard = crate::test_support::EnvVarGuard::capture([
        "FFUI_MOCK_FFMPEG_EXIT_CODE",
        "FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT",
        "FFUI_MOCK_FFMPEG_EMIT_PROGRESS",
        "FFUI_MOCK_FFMPEG_SILENT_WAIT_FOR_Q_TIMEOUT_MS",
    ]);
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EXIT_CODE", "0");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_ENGINE_TOUCH_OUTPUT", "1");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_EMIT_PROGRESS", "0");
    crate::test_support::set_env("FFUI_MOCK_FFMPEG_SILENT_WAIT_FOR_Q_TIMEOUT_MS", "5000");

    let mock_exe = locate_mock_ffmpeg_exe();
    let preset = make_preset("ffmpeg -hide_banner -i INPUT -c:v libx264 -c:a copy OUTPUT");
    let out = validate_preset_template_with_program(
        &preset,
        mock_exe.to_string_lossy().as_ref(),
        Some("custom".to_string()),
        Some(20),
    );
    assert_eq!(out.outcome, PresetTemplateValidationOutcome::TimedOut);
}
