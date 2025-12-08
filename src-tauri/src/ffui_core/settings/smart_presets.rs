use crate::ffui_core::domain::{
    AudioCodecType, AudioConfig, EncoderType, FFmpegPreset, FilterConfig, PresetStats,
    RateControlMode, VideoConfig,
};
use crate::ffui_core::settings::smart_presets_cpu::smart_presets_for_cpu_only;

/// Build a small library of structured FFmpeg presets that act as the basis
/// for hardware-aware smart defaults and the onboarding preset pack.
///
/// These presets intentionally avoid extremely specialised encoder flags so
/// that they remain robust across a wide range of ffmpeg builds, while still
/// capturing the core CRF/CQ/preset/pix_fmt choices recommended in the
/// project docs and external research.
pub fn hardware_smart_default_presets(has_nvidia_gpu: bool) -> Vec<FFmpegPreset> {
    if has_nvidia_gpu {
        smart_presets_for_nvidia()
    } else {
        smart_presets_for_cpu_only()
    }
}

fn empty_stats() -> PresetStats {
    PresetStats {
        usage_count: 0,
        total_input_size_mb: 0.0,
        total_output_size_mb: 0.0,
        total_time_seconds: 0.0,
    }
}

fn smart_presets_for_nvidia() -> Vec<FFmpegPreset> {
    vec![
        FFmpegPreset {
            id: "smart-hevc-fast".to_string(),
            name: "H.265 Fast NVENC".to_string(),
            description:
                "HEVC NVENC CQ 28, preset p5, keeps source resolution for quick web/share."
                    .to_string(),
            global: None,
            input: None,
            mapping: None,
            video: VideoConfig {
                encoder: EncoderType::HevcNvenc,
                rate_control: RateControlMode::Cq,
                quality_value: 28,
                preset: "p5".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
                level: None,
                gop_size: Some(120),
                bf: Some(3),
                pix_fmt: Some("yuv420p".to_string()),
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
            stats: empty_stats(),
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
        FFmpegPreset {
            id: "smart-hevc-archive".to_string(),
            name: "H.265 Archival NVENC".to_string(),
            description:
                "HEVC NVENC CQ 20, preset p7, 10-bit output for visually lossless archival."
                    .to_string(),
            global: None,
            input: None,
            mapping: None,
            video: VideoConfig {
                encoder: EncoderType::HevcNvenc,
                rate_control: RateControlMode::Cq,
                quality_value: 20,
                preset: "p7".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
                level: None,
                gop_size: Some(60),
                bf: Some(3),
                pix_fmt: Some("yuv420p10le".to_string()),
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
            stats: empty_stats(),
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
        FFmpegPreset {
            id: "smart-av1-fast".to_string(),
            name: "AV1 Fast (SVT)".to_string(),
            description:
                "libsvtav1 CRF 34 preset 6, 10-bit output keeping source resolution for high-efficiency fast compression."
                    .to_string(),
            global: None,
            input: None,
            mapping: None,
            video: VideoConfig {
                encoder: EncoderType::LibSvtAv1,
                rate_control: RateControlMode::Crf,
                quality_value: 34,
                preset: "6".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
                level: None,
                gop_size: Some(240),
                bf: Some(3),
                pix_fmt: Some("yuv420p10le".to_string()),
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
            stats: empty_stats(),
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
        FFmpegPreset {
            id: "smart-av1-archive".to_string(),
            name: "AV1 Archival (SVT)".to_string(),
            description:
                "libsvtav1 CRF 24 preset 6, 10-bit output tuned for visually lossless archival."
                    .to_string(),
            global: None,
            input: None,
            mapping: None,
            video: VideoConfig {
                encoder: EncoderType::LibSvtAv1,
                rate_control: RateControlMode::Crf,
                quality_value: 24,
                preset: "6".to_string(),
                tune: None,
                profile: None,
                bitrate_kbps: None,
                max_bitrate_kbps: None,
                buffer_size_kbits: None,
                pass: None,
                level: None,
                gop_size: Some(240),
                bf: Some(3),
                pix_fmt: Some("yuv420p10le".to_string()),
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
            stats: empty_stats(),
            advanced_enabled: Some(false),
            ffmpeg_template: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_smart_default_presets_builds_four_presets_for_nvidia_and_cpu() {
        let nvidia = hardware_smart_default_presets(true);
        let cpu_only = hardware_smart_default_presets(false);

        assert_eq!(
            nvidia.len(),
            4,
            "NVIDIA smart presets should contain exactly four entries"
        );
        assert_eq!(
            cpu_only.len(),
            4,
            "CPU-only smart presets should contain exactly four entries"
        );

        // IDs must be stable and consistent across hardware variants so that
        // onboarding and UI code can rely on them when marking recommended
        // presets.
        let nvidia_ids: Vec<_> = nvidia.iter().map(|p| p.id.as_str()).collect();
        let cpu_ids: Vec<_> = cpu_only.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(
            nvidia_ids, cpu_ids,
            "smart preset IDs must be identical between NVIDIA and CPU-only variants"
        );

        for preset in nvidia.iter().chain(cpu_only.iter()) {
            assert!(
                preset.filters.scale.is_none(),
                "smart preset {} should not downscale by default",
                preset.id
            );
        }

        // NVIDIA branch should use HEVC NVENC for the H.265 slots and libsvtav1
        // for AV1 slots so that we benefit from hardware where available.
        let nvenc_count = nvidia
            .iter()
            .filter(|p| matches!(p.video.encoder, EncoderType::HevcNvenc))
            .count();
        let av1_count = nvidia
            .iter()
            .filter(|p| matches!(p.video.encoder, EncoderType::LibSvtAv1))
            .count();
        assert_eq!(
            nvenc_count, 2,
            "expected exactly two HEVC NVENC presets in NVIDIA smart defaults"
        );
        assert_eq!(
            av1_count, 2,
            "expected exactly two libsvtav1 presets in NVIDIA smart defaults"
        );

        // CPU-only branch keeps the same IDs but should not reference NVENC.
        assert!(
            cpu_only
                .iter()
                .all(|p| !matches!(p.video.encoder, EncoderType::HevcNvenc)),
            "CPU-only smart presets must not use HEVC NVENC encoder"
        );
    }
}
