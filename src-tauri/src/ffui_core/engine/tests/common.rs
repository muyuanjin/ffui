use super::*;

pub(super) fn make_test_preset() -> FFmpegPreset {
    FFmpegPreset {
        id: "preset-1".to_string(),
        name: "Test Preset".to_string(),
        description: "Preset used for unit tests".to_string(),
        description_i18n: None,
        global: None,
        input: None,
        mapping: None,
        video: VideoConfig {
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
        audio: AudioConfig {
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
        filters: FilterConfig {
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
        stats: PresetStats {
            usage_count: 0,
            total_input_size_mb: 0.0,
            total_output_size_mb: 0.0,
            total_time_seconds: 0.0,
        },
        advanced_enabled: Some(false),
        ffmpeg_template: None,
        is_smart_preset: None,
    }
}

pub(super) fn make_engine_with_preset() -> TranscodingEngine {
    let presets = vec![make_test_preset()];
    let settings = AppSettings::default();
    let inner = Arc::new(Inner::new(presets, settings));
    TranscodingEngine { inner }
}

pub(super) fn lock_mock_ffmpeg_env() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock_unpoisoned()
}

pub(super) fn assert_path_eventually_gone(path: &std::path::Path, message: &str) {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_millis(800);
    while path.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!path.exists(), "{message}");
}

/// Best-effort check whether `ffmpeg` is available on PATH.
pub(super) fn ffmpeg_available() -> bool {
    // 为了避免在测试环境中误触发系统弹窗，这里的 ffmpeg 集成测试默认是
    // “按需开启”的：只有当显式设置了环境变量
    //   FFUI_ENABLE_FFMPEG_INTEGRATION_TESTS=1
    // 时才会真正尝试运行 PATH 中的 ffmpeg。
    //
    // 这样可以：
    // - 保证默认跑 `cargo test` 时不会启动任何外部 ffmpeg 进程，更不会弹出 “32
    //   位程序无法运行”等系统提示；
    // - 仍然允许在 CI 或特定开发机上，通过设置环境变量启用真实的 ffmpeg 集成测试。
    if std::env::var("FFUI_ENABLE_FFMPEG_INTEGRATION_TESTS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        Command::new("ffmpeg")
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        // 环境变量未开启时，一律视为“不可用”，让依赖它的集成测试走跳过分支。
        false
    }
}

/// Generate a tiny synthetic MP4 file for integration tests using ffmpeg's
/// built-in testsrc filter. Returns true on success.
pub(super) fn generate_test_input_video(path: &std::path::Path) -> bool {
    // 这里假定调用方已经通过 `ffmpeg_available()` 做过一次环境探测，
    // 且仅在返回 true 时才会调用本函数。这样默认环境（未开启集成测试）
    // 下完全不会尝试启动外部 ffmpeg 进程。
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x180:rate=30",
            "-t",
            "0.5",
            "-pix_fmt",
            "yuv420p",
            path.to_string_lossy().as_ref(),
        ])
        .status();
    matches!(status, Ok(s) if s.success())
}
