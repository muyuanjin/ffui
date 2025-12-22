use tauri::{
    AppHandle,
    State,
};

use crate::app_exit::{
    ExitAutoWaitOutcome,
    ExitCoordinator,
    pause_processing_jobs_for_exit,
};
use crate::ffui_core::TranscodingEngine;

#[tauri::command]
pub fn reset_exit_prompt(coordinator: State<'_, ExitCoordinator>) {
    coordinator.reset_prompt_emitted();
}

#[tauri::command]
pub async fn exit_app_now(
    app: AppHandle,
    coordinator: State<'_, ExitCoordinator>,
) -> Result<(), String> {
    coordinator.allow_exit();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn exit_app_with_auto_wait(
    app: AppHandle,
    engine: State<'_, TranscodingEngine>,
    coordinator: State<'_, ExitCoordinator>,
) -> Result<ExitAutoWaitOutcome, String> {
    let engine = engine.inner().clone();
    let timeout_seconds = {
        let state = engine.inner.state.lock().expect("engine state poisoned");
        state.settings.exit_auto_wait_timeout_seconds
    };

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        pause_processing_jobs_for_exit(&engine, timeout_seconds)
    })
    .await
    .map_err(|e| format!("failed to join exit_app_with_auto_wait task: {e}"))?;

    coordinator.allow_exit();
    app.exit(0);
    Ok(outcome)
}
