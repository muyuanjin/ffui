//! FFmpeg preset management commands.
//!
//! Provides commands for managing FFmpeg presets:
//! - Getting all available presets
//! - Creating and saving new presets
//! - Deleting existing presets

use tauri::State;

use crate::ffui_core::{FFmpegPreset, TranscodingEngine};

/// Get all available FFmpeg presets.
#[tauri::command]
pub fn get_presets(engine: State<TranscodingEngine>) -> Vec<FFmpegPreset> {
    engine.presets()
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
