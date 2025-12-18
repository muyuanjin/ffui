#[cfg(test)]
use std::sync::Mutex;

use anyhow::Result;

use super::io::{
    executable_sidecar_path,
    read_json_file,
    write_json_file,
};
use crate::ffui_core::domain::{
    AudioCodecType,
    AudioConfig,
    EncoderType,
    FFmpegPreset,
    FilterConfig,
    PresetStats,
    RateControlMode,
    VideoConfig,
};

// Many unit tests (and some integration-style tests) touch the same
// `{binary}.presets.json` sidecar path next to the test executable.
// Guard this path under `cfg(test)` so unrelated tests cannot race and
// accidentally overwrite or observe a partially-updated file.
#[cfg(test)]
static PRESETS_SIDECAR_MUTEX: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(super) fn with_presets_sidecar_lock<T>(f: impl FnOnce() -> T) -> T {
    use std::cell::Cell;

    thread_local! {
        static HELD: Cell<bool> = const { Cell::new(false) };
    }

    // Allow re-entrancy within the same thread so tests can compose
    // `with_presets_sidecar_lock` with `load_presets`/`save_presets` without
    // deadlocking on the non-reentrant std::sync::Mutex.
    if HELD.with(|flag| flag.get()) {
        return f();
    }

    let _guard = PRESETS_SIDECAR_MUTEX
        .lock()
        .expect("preset sidecar mutex poisoned");
    HELD.with(|flag| flag.set(true));
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            HELD.with(|flag| flag.set(false));
        }
    }
    let _reset = Reset;
    f()
}

#[cfg(not(test))]
fn with_presets_sidecar_lock<T>(f: impl FnOnce() -> T) -> T {
    f()
}

/// Build the original pair of x264-based default presets used before the
/// onboarding-driven smart presets were introduced.
///
/// These remain as a compatibility fallback and are injected when no
/// presets sidecar exists and onboarding/smart defaults have not yet been
/// applied. New smart default packs are built on top of a richer recipe
/// library and do not rely on this helper.
pub(super) fn default_presets() -> Vec<FFmpegPreset> {
    vec![
        FFmpegPreset {
            id: "p1".to_string(),
            name: "Universal 1080p".to_string(),
            description: "x264 Medium CRF 23. Standard for web.".to_string(),
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
                scale: Some("-2:1080".to_string()),
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
        },
        FFmpegPreset {
            id: "p2".to_string(),
            name: "Archive Master".to_string(),
            description: "x264 Slow CRF 18. Near lossless.".to_string(),
            description_i18n: None,
            global: None,
            input: None,
            mapping: None,
            video: VideoConfig {
                encoder: EncoderType::Libx264,
                rate_control: RateControlMode::Crf,
                quality_value: 18,
                preset: "slow".to_string(),
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
        },
    ]
}

pub fn load_presets() -> Result<Vec<FFmpegPreset>> {
    with_presets_sidecar_lock(|| {
        let path = executable_sidecar_path("presets.json")?;
        // When there is no presets.json yet (fresh install), or when the file is
        // unreadable/empty, fall back to the built-in defaults so well-known
        // presets like "Universal 1080p" (id p1) are always present for the
        // transcoding engine. Otherwise, respect exactly what the user saved
        // (including intentional removal of built-in presets).
        let presets: Vec<FFmpegPreset> = if !path.exists() {
            default_presets()
        } else {
            match read_json_file::<Vec<FFmpegPreset>>(&path) {
                Ok(existing) if !existing.is_empty() => existing,
                Ok(_) => default_presets(),
                Err(err) => {
                    eprintln!("failed to load presets from {}: {err:#}", path.display());
                    default_presets()
                }
            }
        };

        Ok(presets)
    })
}

pub fn save_presets(presets: &[FFmpegPreset]) -> Result<()> {
    with_presets_sidecar_lock(|| {
        let path = executable_sidecar_path("presets.json")?;
        write_json_file(&path, presets)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_presets_start_with_zero_stats() {
        let presets = default_presets();
        assert!(!presets.is_empty(), "default_presets should not be empty");
        for preset in presets {
            assert_eq!(preset.stats.usage_count, 0);
            assert_eq!(preset.stats.total_input_size_mb, 0.0);
            assert_eq!(preset.stats.total_output_size_mb, 0.0);
            assert_eq!(preset.stats.total_time_seconds, 0.0);
        }
    }
}
