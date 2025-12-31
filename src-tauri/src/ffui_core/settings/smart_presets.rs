use std::collections::HashMap;

use serde::Deserialize;

use crate::ffui_core::domain::{
    AudioConfig, ContainerConfig, FFmpegPreset, FilterConfig, GlobalConfig, HardwareConfig,
    InputTimelineConfig, MappingConfig, PresetStats, SubtitlesConfig, VideoConfig,
};
use crate::ffui_core::settings::presets::default_presets;
use crate::ffui_core::settings::smart_presets_cpu::smart_presets_for_cpu_only;

const SMART_PRESETS_JSON: &str = include_str!("../../../assets/smart-presets.json");

/// Build a small library of structured `FFmpeg` presets that act as the basis
/// for hardware-aware smart defaults and the onboarding preset pack.
///
/// This now loads from the data file `assets/smart-presets.json`, where each
/// preset包含自身的匹配条件和优先级，便于按硬件选择合适的变体。
pub fn hardware_smart_default_presets(has_nvidia_gpu: bool) -> Vec<FFmpegPreset> {
    let env = SmartPresetEnv {
        gpu_available: has_nvidia_gpu,
        gpu_vendor: if has_nvidia_gpu {
            Some("nvidia".to_string())
        } else {
            None
        },
    };

    let records = load_smart_preset_records().unwrap_or_else(|err| {
        crate::debug_eprintln!("failed to load smart presets json: {err:#}");
        Vec::new()
    });

    let presets = select_presets(records, &env);
    if presets.is_empty() {
        // Prefer CPU-only smart presets when没有 GPU 时也要给出合理的默认值。
        if !has_nvidia_gpu {
            let cpu_presets = smart_presets_for_cpu_only();
            if !cpu_presets.is_empty() {
                return cpu_presets;
            }
        }
        // Fallback to the classic built-in defaults so onboarding never returns empty.
        return default_presets();
    }
    presets
}

fn select_presets(records: Vec<SmartPresetRecord>, env: &SmartPresetEnv) -> Vec<FFmpegPreset> {
    let mut candidates: Vec<_> = records
        .into_iter()
        .filter(|r| r.expose && r.r#match.matches(env))
        .collect();

    candidates.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then(a.preset.name.cmp(&b.preset.name))
    });

    let mut by_id: HashMap<String, SmartPresetRecord> = HashMap::new();
    for record in candidates {
        by_id.entry(record.preset.id.clone()).or_insert(record);
    }

    by_id
        .into_values()
        .map(|r| r.preset.into())
        .collect::<Vec<_>>()
}

fn load_smart_preset_records() -> Result<Vec<SmartPresetRecord>, serde_json::Error> {
    let parsed: SmartPresetFile = serde_json::from_str(SMART_PRESETS_JSON)?;
    Ok(parsed.presets)
}

#[derive(Debug, Deserialize)]
struct SmartPresetFile {
    #[allow(dead_code)]
    version: Option<u32>,
    presets: Vec<SmartPresetRecord>,
}

#[derive(Debug, Deserialize)]
struct SmartPresetRecord {
    #[serde(flatten)]
    preset: SerializablePreset,
    #[serde(default)]
    r#match: MatchCriteria,
    #[serde(default)]
    priority: i32,
    #[serde(default = "default_true")]
    #[allow(dead_code)]
    default_selected: bool,
    #[serde(default = "default_true")]
    expose: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MatchCriteria {
    #[serde(default)]
    gpu: Option<GpuMatch>,
}

impl MatchCriteria {
    fn matches(&self, env: &SmartPresetEnv) -> bool {
        if let Some(gpu) = &self.gpu {
            if let Some(required) = gpu.available
                && required != env.gpu_available
            {
                return false;
            }
            if let Some(vendor) = gpu.vendor.as_deref()
                && env.gpu_vendor.as_deref() != Some(vendor)
            {
                return false;
            }
        }
        true
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GpuMatch {
    available: Option<bool>,
    vendor: Option<String>,
}

#[derive(Debug)]
struct SmartPresetEnv {
    gpu_available: bool,
    gpu_vendor: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SerializablePreset {
    id: String,
    name: String,
    description: String,
    #[serde(default)]
    description_i18n: Option<HashMap<String, String>>,
    #[serde(default)]
    global: Option<GlobalConfig>,
    #[serde(default)]
    input: Option<InputTimelineConfig>,
    #[serde(default)]
    mapping: Option<MappingConfig>,
    video: VideoConfig,
    audio: AudioConfig,
    #[serde(default = "default_filter_config")]
    filters: FilterConfig,
    #[serde(default)]
    subtitles: Option<SubtitlesConfig>,
    #[serde(default)]
    container: Option<ContainerConfig>,
    #[serde(default)]
    hardware: Option<HardwareConfig>,
    #[serde(default = "empty_stats")]
    stats: PresetStats,
    #[serde(default)]
    advanced_enabled: Option<bool>,
    #[serde(default)]
    ffmpeg_template: Option<String>,
}

impl From<SerializablePreset> for FFmpegPreset {
    fn from(value: SerializablePreset) -> Self {
        Self {
            id: value.id,
            name: value.name,
            description: value.description,
            description_i18n: value.description_i18n,
            global: value.global,
            input: value.input,
            mapping: value.mapping,
            video: value.video,
            audio: value.audio,
            filters: value.filters,
            subtitles: value.subtitles,
            container: value.container,
            hardware: value.hardware,
            stats: value.stats,
            advanced_enabled: value.advanced_enabled,
            ffmpeg_template: value.ffmpeg_template,
            // 从 JSON 加载的智能预设默认标记为智能推荐
            is_smart_preset: Some(true),
        }
    }
}

const fn empty_stats() -> PresetStats {
    PresetStats {
        usage_count: 0,
        total_input_size_mb: 0.0,
        total_output_size_mb: 0.0,
        total_time_seconds: 0.0,
        total_frames: 0.0,
    }
}

const fn default_filter_config() -> FilterConfig {
    FilterConfig {
        scale: None,
        crop: None,
        fps: None,
        vf_chain: None,
        af_chain: None,
        filter_complex: None,
    }
}

const fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_smart_default_presets_use_json_and_match_gpu_flag() {
        let nvidia = hardware_smart_default_presets(true);
        let cpu_only = hardware_smart_default_presets(false);

        assert!(
            !nvidia.is_empty(),
            "NVIDIA smart presets should not be empty"
        );
        assert!(
            !cpu_only.is_empty(),
            "CPU smart presets should not be empty"
        );

        let has_nvenc = nvidia.iter().any(|p| {
            matches!(
                p.video.encoder,
                crate::ffui_core::domain::EncoderType::HevcNvenc
                    | crate::ffui_core::domain::EncoderType::H264Nvenc
                    | crate::ffui_core::domain::EncoderType::Av1Nvenc
            )
        });
        assert!(
            has_nvenc,
            "GPU smart presets should contain at least one NVENC-driven entry"
        );

        assert!(
            cpu_only.iter().all(|p| !matches!(
                p.video.encoder,
                crate::ffui_core::domain::EncoderType::HevcNvenc
                    | crate::ffui_core::domain::EncoderType::H264Nvenc
                    | crate::ffui_core::domain::EncoderType::Av1Nvenc
            )),
            "CPU smart presets must not include NVENC encoders"
        );

        assert!(
            cpu_only.iter().any(|p| matches!(
                p.video.encoder,
                crate::ffui_core::domain::EncoderType::Libx264
                    | crate::ffui_core::domain::EncoderType::Libx265
                    | crate::ffui_core::domain::EncoderType::LibSvtAv1
            )),
            "CPU smart presets should include at least one CPU encoder"
        );
    }

    #[test]
    fn smart_presets_preserve_description_i18n() {
        let nvidia = hardware_smart_default_presets(true);
        let preset = nvidia
            .iter()
            .find(|p| p.id == "smart-hevc-fast")
            .expect("smart-hevc-fast should exist for NVIDIA");

        let dict = preset
            .description_i18n
            .as_ref()
            .expect("description_i18n should be preserved from JSON");

        let en = dict.get("en").expect("English description should exist");
        assert_ne!(
            en, &preset.description,
            "English description should not fall back to the default Chinese string"
        );
        assert!(
            dict.contains_key("zh-CN"),
            "Chinese translation should also be available"
        );
    }
}
