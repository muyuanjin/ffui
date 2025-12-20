use std::path::Path;
use std::time::{
    SystemTime,
    UNIX_EPOCH,
};

use anyhow::{
    Context,
    Result,
    bail,
};
use serde::{
    Deserialize,
    Serialize,
};

use crate::ffui_core::settings::io::{
    read_json_file,
    write_json_file,
};
use crate::ffui_core::{
    FFmpegPreset,
    PresetStats,
};

pub const PRESET_BUNDLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetBundle {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at_ms: u64,
    pub presets: Vec<FFmpegPreset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetBundleExportResult {
    pub path: String,
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at_ms: u64,
    pub preset_count: usize,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn zero_stats() -> PresetStats {
    PresetStats {
        usage_count: 0,
        total_input_size_mb: 0.0,
        total_output_size_mb: 0.0,
        total_time_seconds: 0.0,
    }
}

fn sanitize_preset_for_export(mut preset: FFmpegPreset) -> FFmpegPreset {
    preset.stats = zero_stats();
    preset
}

fn validate_preset_bundle(bundle: &PresetBundle) -> Result<()> {
    if bundle.schema_version != PRESET_BUNDLE_SCHEMA_VERSION {
        bail!(
            "unsupported preset bundle schema {} (expected {})",
            bundle.schema_version,
            PRESET_BUNDLE_SCHEMA_VERSION
        );
    }
    Ok(())
}

pub fn export_presets_bundle(
    path: &Path,
    presets: Vec<FFmpegPreset>,
    app_version: String,
) -> Result<PresetBundleExportResult> {
    let exported_at_ms = now_ms();
    let sanitized = presets
        .into_iter()
        .map(sanitize_preset_for_export)
        .collect::<Vec<_>>();
    let bundle = PresetBundle {
        schema_version: PRESET_BUNDLE_SCHEMA_VERSION,
        app_version: app_version.clone(),
        exported_at_ms,
        presets: sanitized,
    };
    write_json_file(path, &bundle)
        .with_context(|| format!("failed to write preset bundle {}", path.display()))?;
    Ok(PresetBundleExportResult {
        path: path.to_string_lossy().into_owned(),
        schema_version: bundle.schema_version,
        app_version,
        exported_at_ms,
        preset_count: bundle.presets.len(),
    })
}

pub fn read_presets_bundle(path: &Path) -> Result<PresetBundle> {
    let bundle = read_json_file::<PresetBundle>(path)
        .with_context(|| format!("failed to read preset bundle {}", path.display()))?;
    validate_preset_bundle(&bundle)?;
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn make_preset_with_stats(id: &str, usage: u64) -> FFmpegPreset {
        FFmpegPreset {
            id: id.to_string(),
            name: format!("Preset {id}"),
            description: "test".to_string(),
            description_i18n: None,
            global: None,
            input: None,
            mapping: None,
            video: crate::ffui_core::domain::VideoConfig {
                encoder: crate::ffui_core::domain::EncoderType::Libx264,
                rate_control: crate::ffui_core::domain::RateControlMode::Crf,
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
                codec: crate::ffui_core::domain::AudioCodecType::Copy,
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
            stats: PresetStats {
                usage_count: usage,
                total_input_size_mb: 12.5,
                total_output_size_mb: 3.5,
                total_time_seconds: 42.0,
            },
            advanced_enabled: Some(false),
            ffmpeg_template: None,
            is_smart_preset: None,
        }
    }

    #[test]
    fn export_bundle_writes_metadata_and_zeros_stats() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("presets.json");
        let presets = vec![make_preset_with_stats("p1", 3)];

        let result =
            export_presets_bundle(&path, presets, "0.0.0-test".to_string()).expect("export");
        assert_eq!(result.path, path.to_string_lossy());
        assert_eq!(result.schema_version, PRESET_BUNDLE_SCHEMA_VERSION);
        assert_eq!(result.app_version, "0.0.0-test");
        assert!(result.exported_at_ms > 0);
        assert_eq!(result.preset_count, 1);

        let bundle = read_json_file::<PresetBundle>(&path).expect("read bundle");
        assert_eq!(bundle.schema_version, PRESET_BUNDLE_SCHEMA_VERSION);
        assert_eq!(bundle.presets.len(), 1);
        let preset = bundle.presets.first().expect("preset");
        assert_eq!(preset.stats.usage_count, 0);
        assert_eq!(preset.stats.total_input_size_mb, 0.0);
        assert_eq!(preset.stats.total_output_size_mb, 0.0);
        assert_eq!(preset.stats.total_time_seconds, 0.0);
    }

    #[test]
    fn read_bundle_rejects_wrong_schema() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("presets.json");
        let bundle = PresetBundle {
            schema_version: 99,
            app_version: "0.0.0-test".to_string(),
            exported_at_ms: 1,
            presets: vec![],
        };
        write_json_file(&path, &bundle).expect("write test bundle");
        let err = read_presets_bundle(&path).expect_err("schema mismatch should fail");
        assert!(err.to_string().contains("unsupported preset bundle schema"));
    }

    #[test]
    fn read_bundle_round_trips_valid_schema() {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join("presets.json");
        let bundle = PresetBundle {
            schema_version: PRESET_BUNDLE_SCHEMA_VERSION,
            app_version: "0.0.0-test".to_string(),
            exported_at_ms: 1,
            presets: vec![make_preset_with_stats("p1", 0)],
        };
        write_json_file(&path, &bundle).expect("write test bundle");
        let loaded = read_presets_bundle(&path).expect("read bundle");
        assert_eq!(loaded.schema_version, PRESET_BUNDLE_SCHEMA_VERSION);
        assert_eq!(loaded.presets.len(), 1);
        assert_eq!(loaded.presets[0].id, "p1");
    }
}
