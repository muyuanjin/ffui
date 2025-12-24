use serde::Deserialize;
use tauri::State;

use crate::ffui_core::{
    FallbackFramePosition,
    FallbackFrameQuality,
    TranscodingEngine,
    clear_fallback_frame_cache,
    extract_fallback_frame,
};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameQualityParam {
    Low,
    High,
}

impl From<FrameQualityParam> for FallbackFrameQuality {
    fn from(value: FrameQualityParam) -> Self {
        match value {
            FrameQualityParam::Low => Self::Low,
            FrameQualityParam::High => Self::High,
        }
    }
}

/// Extract a cached fallback preview frame (JPEG) at a requested position.
///
/// This is used when the Webview cannot natively decode the video for `<video>`,
/// so the UI can still provide a static scrub preview backed by `FFmpeg`.
#[tauri::command]
pub fn extract_fallback_preview_frame(
    engine: State<'_, TranscodingEngine>,
    source_path: String,
    position_percent: Option<f64>,
    position_seconds: Option<f64>,
    duration_seconds: Option<f64>,
    quality: FrameQualityParam,
) -> Result<String, String> {
    let position = match (position_percent, position_seconds) {
        (Some(p), None) => FallbackFramePosition::Percent(p),
        (None, Some(s)) => FallbackFramePosition::Seconds(s),
        _ => {
            return Err(
                "must provide exactly one of positionPercent or positionSeconds".to_string(),
            );
        }
    };

    let settings = engine.settings();
    let path = extract_fallback_frame(
        &source_path,
        &settings.tools,
        duration_seconds,
        position,
        quality.into(),
    )
    .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

/// Clear cached fallback preview frames under `previews/fallback-cache/frames`.
///
/// This is a best-effort, non-blocking cleanup used by the UI when leaving
/// the fallback scrub preview surfaces.
#[tauri::command]
pub fn cleanup_fallback_preview_frames_async() -> bool {
    std::thread::Builder::new()
        .name("ffui-fallback-preview-frames-cleanup".to_string())
        .spawn(move || {
            let _ = clear_fallback_frame_cache();
        })
        .is_ok()
}
