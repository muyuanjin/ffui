use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const SHUTDOWN_MARKER_FILENAME: &str = "ffui.shutdown-marker.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ShutdownMarkerKind {
    Running,
    Clean,
    CleanAutoWait,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShutdownMarker {
    pub kind: ShutdownMarkerKind,
    pub at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_wait_processing_job_ids: Option<Vec<String>>,
}

fn shutdown_marker_path() -> Option<PathBuf> {
    crate::ffui_core::data_root_dir()
        .ok()
        .map(|root| root.join(SHUTDOWN_MARKER_FILENAME))
}

pub(crate) fn read_shutdown_marker() -> Option<ShutdownMarker> {
    let path = shutdown_marker_path()?;
    let data = fs::read(&path).ok()?;
    serde_json::from_slice::<ShutdownMarker>(&data).ok()
}

pub(crate) fn write_shutdown_marker(kind: ShutdownMarkerKind) -> bool {
    write_shutdown_marker_with_auto_wait_job_ids(kind, None)
}

pub(crate) fn write_shutdown_marker_with_auto_wait_job_ids(
    kind: ShutdownMarkerKind,
    auto_wait_processing_job_ids: Option<Vec<String>>,
) -> bool {
    let Some(path) = shutdown_marker_path() else {
        return false;
    };

    if let Some(parent) = path.parent()
        && fs::create_dir_all(parent).is_err()
    {
        return false;
    }

    let marker = ShutdownMarker {
        kind,
        at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX),
        auto_wait_processing_job_ids: auto_wait_processing_job_ids
            .and_then(|ids| if ids.is_empty() { None } else { Some(ids) }),
    };

    let tmp_path = path.with_extension("tmp");
    match fs::File::create(&tmp_path) {
        Ok(file) => {
            if serde_json::to_writer_pretty(&file, &marker).is_err() {
                drop(fs::remove_file(&tmp_path));
                return false;
            }
            drop(file);
            drop(fs::rename(&tmp_path, &path));
            true
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_marker_roundtrips_when_data_root_is_overridden() {
        let dir = tempfile::tempdir().expect("tempdir");
        let _guard = crate::ffui_core::override_data_root_dir_for_tests(dir.path().to_path_buf());

        assert!(write_shutdown_marker(ShutdownMarkerKind::Running));
        let marker = read_shutdown_marker().expect("marker should exist");
        assert_eq!(marker.kind, ShutdownMarkerKind::Running);
        assert!(marker.at_ms > 0);
        assert!(marker.auto_wait_processing_job_ids.is_none());

        assert!(write_shutdown_marker_with_auto_wait_job_ids(
            ShutdownMarkerKind::CleanAutoWait,
            Some(vec!["job-1".to_string(), "job-2".to_string()]),
        ));
        let marker = read_shutdown_marker().expect("marker should exist");
        assert_eq!(marker.kind, ShutdownMarkerKind::CleanAutoWait);
        assert_eq!(
            marker.auto_wait_processing_job_ids,
            Some(vec!["job-1".to_string(), "job-2".to_string()])
        );
    }
}
