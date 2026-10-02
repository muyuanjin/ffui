use tauri::State;

use crate::ffui_core::{
    MediaPreviewInfo, PreviewMediaKind, TranscodingEngine, prepare_media_preview,
    probe_media_preview,
};

#[tauri::command]
pub async fn probe_media_preview_info(
    engine: State<'_, TranscodingEngine>,
    source_path: String,
) -> Result<MediaPreviewInfo, String> {
    let tools = engine.settings().tools;
    tauri::async_runtime::spawn_blocking(move || {
        probe_media_preview(&source_path, &tools).map_err(|error| format!("{error:#}"))
    })
    .await
    .map_err(|error| format!("media preview probe worker failed: {error}"))?
}

#[tauri::command]
pub async fn prepare_native_media_preview(
    engine: State<'_, TranscodingEngine>,
    source_path: String,
    kind: PreviewMediaKind,
) -> Result<String, String> {
    let tools = engine.settings().tools;
    tauri::async_runtime::spawn_blocking(move || {
        prepare_media_preview(&source_path, kind, &tools)
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|error| format!("{error:#}"))
    })
    .await
    .map_err(|error| format!("media preview conversion worker failed: {error}"))?
}
