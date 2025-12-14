use tauri::State;

use crate::ffui_core::{OutputPolicy, TranscodingEngine};

/// Preview the derived output path for a given input file and output policy.
///
/// This is used by the UI to help users understand how container/directory/
/// naming options affect the final output path, without enqueuing a job.
#[tauri::command]
pub fn preview_output_path(
    engine: State<TranscodingEngine>,
    input_path: String,
    preset_id: Option<String>,
    output_policy: OutputPolicy,
) -> Option<String> {
    engine.preview_output_path(input_path, preset_id, output_policy)
}
