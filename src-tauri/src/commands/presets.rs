//! `FFmpeg` preset management commands.
//!
//! Provides commands for managing `FFmpeg` presets:
//! - Getting all available presets
//! - Creating and saving new presets
//! - Deleting existing presets

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, State};

use crate::ffui_core::EncoderType;
use crate::ffui_core::tools::{ExternalToolKind, resolve_tool_path};
use crate::ffui_core::{
    FFmpegPreset, PresetBundle, PresetBundleExportResult, PresetTemplateValidationResult,
    TranscodingEngine, export_presets_bundle as export_presets_bundle_impl,
    hardware_smart_default_presets, read_presets_bundle as read_presets_bundle_impl,
    validate_preset_template as validate_preset_template_impl,
};

/// Get all available `FFmpeg` presets.
#[tauri::command]
pub fn get_presets(engine: State<'_, TranscodingEngine>) -> Arc<Vec<FFmpegPreset>> {
    engine.presets()
}

/// Get a recommended pack of smart default presets based on current hardware.
///
/// This does not modify the persisted presets; it only returns a candidate
/// list that the onboarding flow or UI can present to the user for review.
#[tauri::command]
pub fn get_smart_default_presets(engine: State<'_, TranscodingEngine>) -> Vec<FFmpegPreset> {
    let gpu = engine.gpu_usage();
    let has_nvidia_gpu = gpu.available;
    let mut presets = hardware_smart_default_presets(has_nvidia_gpu);

    // Best-effort: hide smart presets whose encoders are unusable in the current
    // ffmpeg binary (e.g. ffmpeg-static builds that omit libsvtav1).
    let tools = engine.settings().tools;
    let (ffmpeg_path, _source) = resolve_tool_path(ExternalToolKind::Ffmpeg, &tools)
        .unwrap_or_else(|_| ("ffmpeg".to_string(), "path".to_string()));

    let mut cache: std::collections::HashMap<&'static str, bool> = std::collections::HashMap::new();
    presets.retain(|preset| {
        let Some(enc) = encoder_name_for_preset(preset) else {
            return true;
        };
        *cache.entry(enc).or_insert_with(|| {
            should_keep_preset_for_encoder(enc, || {
                crate::ffui_core::tools::ensure_ffmpeg_video_encoder_usable(&ffmpeg_path, enc)
            })
        })
    });

    presets
}

fn encoder_name_for_preset(preset: &FFmpegPreset) -> Option<&'static str> {
    match preset.video.encoder {
        EncoderType::Libx264 => Some("libx264"),
        EncoderType::Libx265 => Some("libx265"),
        EncoderType::HevcNvenc => Some("hevc_nvenc"),
        EncoderType::H264Nvenc => Some("h264_nvenc"),
        EncoderType::Av1Nvenc => Some("av1_nvenc"),
        EncoderType::HevcQsv => Some("hevc_qsv"),
        EncoderType::Av1Qsv => Some("av1_qsv"),
        EncoderType::HevcAmf => Some("hevc_amf"),
        EncoderType::Av1Amf => Some("av1_amf"),
        EncoderType::LibSvtAv1 => Some("libsvtav1"),
        EncoderType::Copy => None,
    }
}

fn should_keep_preset_for_encoder(
    encoder: &str,
    mut probe: impl FnMut() -> Result<(), anyhow::Error>,
) -> bool {
    match probe() {
        Ok(()) => true,
        Err(err) => {
            let msg = format!("{err:#}");
            // If we cannot even spawn ffmpeg (missing binary, sandboxed PATH, etc),
            // keep presets visible instead of returning an empty pack.
            if msg.contains("failed to spawn ffmpeg") || msg.contains("No such file") {
                return true;
            }
            crate::debug_eprintln!(
                "hiding smart preset encoder={encoder} because probe failed: {msg}"
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    #[test]
    fn should_keep_preset_for_encoder_keeps_on_spawn_error() {
        let keep = should_keep_preset_for_encoder("libsvtav1", || {
            Err(anyhow!(
                "failed to spawn ffmpeg for encoder probe: libsvtav1"
            ))
        });
        assert!(keep);
    }

    #[test]
    fn should_keep_preset_for_encoder_filters_on_real_probe_failure() {
        let keep = should_keep_preset_for_encoder("libsvtav1", || {
            Err(anyhow!(
                "ffmpeg encoder probe failed: encoder=libsvtav1\nUnknown encoder 'libsvtav1'"
            ))
        });
        assert!(!keep);
    }

    #[test]
    fn encoder_name_for_preset_maps_copy_to_none() {
        let mut presets = hardware_smart_default_presets(false);
        let Some(mut preset) = presets.pop() else {
            return;
        };
        preset.video.encoder = EncoderType::Copy;
        assert_eq!(encoder_name_for_preset(&preset), None);
    }
}

/// Save a new `FFmpeg` preset or update an existing one.
#[tauri::command]
pub fn save_preset(
    engine: State<'_, TranscodingEngine>,
    preset: FFmpegPreset,
) -> Result<Arc<Vec<FFmpegPreset>>, String> {
    engine.save_preset(preset).map_err(|e| e.to_string())
}

/// Delete an `FFmpeg` preset by ID.
#[tauri::command]
pub fn delete_preset(
    engine: State<'_, TranscodingEngine>,
    preset_id: String,
) -> Result<Arc<Vec<FFmpegPreset>>, String> {
    engine.delete_preset(&preset_id).map_err(|e| e.to_string())
}

/// Reorder presets according to the provided list of IDs.
#[tauri::command]
pub fn reorder_presets(
    engine: State<'_, TranscodingEngine>,
    ordered_ids: Vec<String>,
) -> Result<Arc<Vec<FFmpegPreset>>, String> {
    engine
        .reorder_presets(&ordered_ids)
        .map_err(|e| e.to_string())
}

/// Export a selected set of presets to a JSON bundle on disk.
///
/// Export always zeroes stats fields so the bundle is "parameters-only".
#[tauri::command]
pub async fn export_presets_bundle(
    app: AppHandle,
    engine: State<'_, TranscodingEngine>,
    target_path: String,
    preset_ids: Vec<String>,
) -> Result<PresetBundleExportResult, String> {
    let app_version = app.package_info().version.to_string();
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = target_path.trim();
        if trimmed.is_empty() {
            return Err("export path is empty".to_string());
        }
        if preset_ids.is_empty() {
            return Err("no presets selected".to_string());
        }

        let path = Path::new(trimmed);
        let ids: HashSet<&str> = preset_ids.iter().map(String::as_str).collect();
        let selected = engine
            .presets()
            .iter()
            .filter(|preset| ids.contains(preset.id.as_str()))
            .cloned()
            .collect::<Vec<_>>();

        if selected.is_empty() {
            return Err("no matching presets found".to_string());
        }

        export_presets_bundle_impl(path, selected, app_version).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a preset bundle JSON file from disk.
#[tauri::command]
pub async fn read_presets_bundle(source_path: String) -> Result<PresetBundle, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = source_path.trim();
        if trimmed.is_empty() {
            return Err("import path is empty".to_string());
        }
        let path = Path::new(trimmed);
        if !path.is_file() {
            return Err("import path does not point to a file".to_string());
        }
        read_presets_bundle_impl(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Quick-validate an advanced/template preset by running ffmpeg once against a tiny built-in input.
#[tauri::command]
pub async fn validate_preset_template(
    engine: State<'_, TranscodingEngine>,
    preset: FFmpegPreset,
    timeout_ms: Option<u64>,
) -> Result<PresetTemplateValidationResult, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(validate_preset_template_impl(&engine, preset, timeout_ms))
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Ensure a known sample video is downloaded on disk for VMAF calibration.
///
/// Returns the local file path (string) that the frontend can pass back into
/// `measure_preset_vmaf`.
#[tauri::command]
pub async fn download_vmaf_sample_video(
    _app: AppHandle,
    sample_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sample_id = sample_id.trim();
        if sample_id.is_empty() {
            return Err("sampleId is empty".to_string());
        }

        let (url, expected_sha256) = match sample_id {
            // Keep in sync with `src/lib/vqResults/__fixtures__/vmafAnchor.bbb1080p30s.defaultSelected.json`.
            "bbb1080p30s" => (
                "https://raw.githubusercontent.com/bower-media-samples/big-buck-bunny-1080p-30s/master/video.mp4",
                "07b756a4c7b481829776645c153167ca14c9df802ddbea7dffda3d817aa5261a",
            ),
            _ => return Err(format!("unknown sampleId: {sample_id}")),
        };

        fn to_hex(bytes: &[u8]) -> String {
            const HEX: &[u8; 16] = b"0123456789abcdef";
            let mut out = String::with_capacity(bytes.len() * 2);
            for &b in bytes {
                out.push(HEX[(b >> 4) as usize] as char);
                out.push(HEX[(b & 0x0F) as usize] as char);
            }
            out
        }

        fn sha256_file_hex(path: &Path) -> Result<String, anyhow::Error> {
            use sha2::{Digest, Sha256};
            let mut file = fs::File::open(path)?;
            let mut hasher = Sha256::new();
            let mut buf = [0u8; 1024 * 64];
            loop {
                let n = file.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
            Ok(to_hex(&hasher.finalize()))
        }

        let data_root = crate::ffui_core::data_root_dir().map_err(|e| e.to_string())?;
        let samples_dir = data_root.join("vmaf").join("samples");
        fs::create_dir_all(&samples_dir).map_err(|e| e.to_string())?;

        let target_path = samples_dir.join(format!("{sample_id}.mp4"));

        if target_path.is_file() {
            match sha256_file_hex(&target_path) {
                Ok(hex) if hex == expected_sha256 => {
                    return Ok(target_path.to_string_lossy().into_owned());
                }
                Ok(_) | Err(_) => {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis();
                    let bak = samples_dir.join(format!("{sample_id}.{now_ms}.bak.mp4"));
                    fs::rename(&target_path, &bak).map_err(|e| e.to_string())?;
                }
            }
        }

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let tmp_path = samples_dir.join(format!("{sample_id}.{now_ms}.download.tmp"));

        let mut resp = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60 * 30))
            .build()
            .map_err(|e| e.to_string())?
            .get(url)
            .send()
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("download failed: HTTP {}", resp.status()));
        }

        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&tmp_path)
            .map_err(|e| e.to_string())?;
        let mut buf = [0u8; 1024 * 64];
        loop {
            let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())?;

        let got = sha256_file_hex(&tmp_path).map_err(|e| e.to_string())?;
        if got != expected_sha256 {
            return Err(format!(
                "downloaded file sha256 mismatch: expected={expected_sha256} got={got}"
            ));
        }

        fs::rename(&tmp_path, &target_path).map_err(|e| e.to_string())?;
        Ok(target_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Encode a reference video with the specified preset, then measure VMAF mean
/// (reference vs encoded output) and aggregate into preset stats.
#[tauri::command]
pub async fn measure_preset_vmaf(
    engine: State<'_, TranscodingEngine>,
    preset_id: String,
    reference_path: String,
    trim_seconds: Option<f64>,
) -> Result<f64, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.measure_preset_vmaf(&preset_id, &reference_path, trim_seconds)
    })
    .await
    .map_err(|e| format!("failed to join measure_preset_vmaf task: {e}"))?
    .map_err(|e| e.to_string())
}
