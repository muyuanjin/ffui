//! `FFmpeg` preset management commands.
//!
//! Provides commands for managing `FFmpeg` presets:
//! - Getting all available presets
//! - Creating and saving new presets
//! - Deleting existing presets

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::ffui_core::{
    FFmpegPreset, PresetBundle, PresetBundleExportResult, TranscodingEngine,
    export_presets_bundle as export_presets_bundle_impl, hardware_smart_default_presets,
    read_presets_bundle as read_presets_bundle_impl,
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
    hardware_smart_default_presets(has_nvidia_gpu)
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
pub fn export_presets_bundle(
    app: AppHandle,
    engine: State<'_, TranscodingEngine>,
    target_path: String,
    preset_ids: Vec<String>,
) -> Result<PresetBundleExportResult, String> {
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

    let app_version = app.package_info().version.to_string();
    export_presets_bundle_impl(path, selected, app_version).map_err(|e| e.to_string())
}

/// Read a preset bundle JSON file from disk.
#[tauri::command]
pub fn read_presets_bundle(source_path: String) -> Result<PresetBundle, String> {
    let trimmed = source_path.trim();
    if trimmed.is_empty() {
        return Err("import path is empty".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_file() {
        return Err("import path does not point to a file".to_string());
    }
    read_presets_bundle_impl(path).map_err(|e| e.to_string())
}
