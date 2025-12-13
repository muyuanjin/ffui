use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Name of the Tauri event used to push today's transcode activity buckets to
/// the frontend.
pub const TRANSCODE_ACTIVITY_TODAY_EVENT_NAME: &str = "ffui://transcode-activity-today";

/// Global app handle used for emitting transcode activity events.
static APP_HANDLE: once_cell::sync::OnceCell<Arc<tauri::AppHandle>> =
    once_cell::sync::OnceCell::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeActivityToday {
    pub date: String,
    pub active_hours: Vec<bool>,
}

pub(crate) fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(Arc::new(handle));
}

pub(crate) fn emit_transcode_activity_today_if_possible(payload: TranscodeActivityToday) {
    let Some(handle) = APP_HANDLE.get() else {
        return;
    };
    if let Err(err) = handle.emit(TRANSCODE_ACTIVITY_TODAY_EVENT_NAME, payload) {
        eprintln!("failed to emit transcode activity event: {err}");
    }
}
