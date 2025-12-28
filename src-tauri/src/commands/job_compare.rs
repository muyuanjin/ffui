//! Job compare commands (input vs output).
//!
//! These commands are on-demand (not part of high-frequency queue snapshots)
//! and are designed to support the "compare window" UI without generating any
//! proxy videos.

mod commands;
mod helpers;
mod types;

use tauri::State;

use crate::ffui_core::TranscodingEngine;

pub use types::{
    ExtractJobCompareConcatFrameArgs, ExtractJobCompareFrameArgs, ExtractJobCompareOutputFrameArgs,
    GetJobCompareSourcesArgs, JobCompareSources,
};

#[tauri::command]
pub fn get_job_compare_sources(
    engine: State<'_, TranscodingEngine>,
    args: GetJobCompareSourcesArgs,
) -> Option<JobCompareSources> {
    commands::get_job_compare_sources(engine, args)
}

#[tauri::command]
pub fn extract_job_compare_frame(
    engine: State<'_, TranscodingEngine>,
    args: ExtractJobCompareFrameArgs,
) -> Result<String, String> {
    commands::extract_job_compare_frame(engine, args)
}

#[tauri::command]
pub fn extract_job_compare_concat_frame(
    engine: State<'_, TranscodingEngine>,
    args: ExtractJobCompareConcatFrameArgs,
) -> Result<String, String> {
    commands::extract_job_compare_concat_frame(engine, args)
}

#[tauri::command]
pub fn extract_job_compare_output_frame(
    engine: State<'_, TranscodingEngine>,
    args: ExtractJobCompareOutputFrameArgs,
) -> Result<String, String> {
    commands::extract_job_compare_output_frame(engine, args)
}

#[cfg(test)]
use helpers::*;

#[cfg(test)]
#[path = "job_compare/tests.rs"]
mod tests;
