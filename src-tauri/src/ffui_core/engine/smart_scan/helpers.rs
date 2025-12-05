use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ffui_core::settings;
use crate::ffui_core::tools::{ExternalToolKind, last_tool_download_metadata};

use super::super::state::{Inner, snapshot_queue_state};

pub(crate) fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn next_job_id(inner: &Inner) -> String {
    inner.next_job_id.fetch_add(1, Ordering::SeqCst).to_string()
}

pub(crate) fn record_tool_download(inner: &Inner, kind: ExternalToolKind, binary_path: &str) {
    if let Some((url, version, tag)) = last_tool_download_metadata(kind) {
        let mut state = inner.state.lock().expect("engine state poisoned");
        let settings_ref = &mut state.settings;
        let tools = &mut settings_ref.tools;

        use crate::ffui_core::settings::{DownloadedToolInfo, DownloadedToolState};

        let downloaded = tools
            .downloaded
            .get_or_insert_with(DownloadedToolState::default);

        let info = DownloadedToolInfo {
            version: version.clone(),
            tag: tag.clone(),
            source_url: Some(url.clone()),
            downloaded_at: Some(current_time_millis()),
        };

        match kind {
            ExternalToolKind::Ffmpeg => {
                downloaded.ffmpeg = Some(info);
                tools.ffmpeg_path = Some(binary_path.to_string());
            }
            ExternalToolKind::Ffprobe => {
                downloaded.ffprobe = Some(info);
                tools.ffprobe_path = Some(binary_path.to_string());
            }
            ExternalToolKind::Avifenc => {
                downloaded.avifenc = Some(info);
                tools.avifenc_path = Some(binary_path.to_string());
            }
        }

        if let Err(err) = settings::save_settings(settings_ref) {
            eprintln!("failed to persist tool download metadata to settings.json: {err:#}");
        }
    }
}

pub(crate) fn notify_queue_listeners(inner: &Inner) {
    let snapshot = snapshot_queue_state(inner);
    let listeners = inner
        .queue_listeners
        .lock()
        .expect("queue listeners poisoned");
    for listener in listeners.iter() {
        listener(snapshot.clone());
    }
}
