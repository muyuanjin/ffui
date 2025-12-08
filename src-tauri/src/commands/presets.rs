//! FFmpeg preset management commands.
//!
//! Provides commands for managing FFmpeg presets:
//! - Getting all available presets
//! - Creating and saving new presets
//! - Deleting existing presets

use tauri::State;

use crate::ffui_core::{FFmpegPreset, TranscodingEngine, hardware_smart_default_presets};

/// Get all available FFmpeg presets.
#[tauri::command]
pub fn get_presets(engine: State<TranscodingEngine>) -> Vec<FFmpegPreset> {
    engine.presets()
}

/// Get a recommended pack of smart default presets based on current hardware.
///
/// This does not modify the persisted presets; it only returns a candidate
/// list that the onboarding flow or UI can present to the user for review.
#[tauri::command]
pub fn get_smart_default_presets(engine: State<TranscodingEngine>) -> Vec<FFmpegPreset> {
    let gpu = engine.gpu_usage();
    let has_nvidia_gpu = gpu.available;
    hardware_smart_default_presets(has_nvidia_gpu)
}

/// Save a new FFmpeg preset or update an existing one.
#[tauri::command]
pub fn save_preset(
    engine: State<TranscodingEngine>,
    preset: FFmpegPreset,
) -> Result<Vec<FFmpegPreset>, String> {
    engine.save_preset(preset).map_err(|e| e.to_string())
}

/// Delete an FFmpeg preset by ID.
#[tauri::command]
pub fn delete_preset(
    engine: State<TranscodingEngine>,
    preset_id: String,
) -> Result<Vec<FFmpegPreset>, String> {
    engine.delete_preset(&preset_id).map_err(|e| e.to_string())
}

/// Reorder presets according to the provided list of IDs.
#[tauri::command]
pub fn reorder_presets(
    engine: State<TranscodingEngine>,
    ordered_ids: Vec<String>,
) -> Result<Vec<FFmpegPreset>, String> {
    engine
        .reorder_presets(&ordered_ids)
        .map_err(|e| e.to_string())
}
