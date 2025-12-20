use std::fs;
use std::path::{
    Path,
    PathBuf,
};

use anyhow::{
    Context,
    Result,
};
use serde::{
    Deserialize,
    Serialize,
};

use super::{
    DataRootMode,
    META_FILENAME,
};
use crate::ffui_core::settings::io::{
    read_json_file,
    write_json_file,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct DataRootMeta {
    pub(super) schema_version: u32,
    pub(super) desired_mode: Option<DataRootMode>,
    pub(super) last_selected_at_ms: Option<u64>,
    pub(super) fallback_notice_dismissed: Option<bool>,
}

pub(super) fn meta_path(root: &Path) -> PathBuf {
    root.join(META_FILENAME)
}

pub(super) fn read_meta(root: &Path) -> Option<DataRootMeta> {
    let path = meta_path(root);
    if !path.exists() {
        return None;
    }
    match read_json_file::<DataRootMeta>(&path) {
        Ok(meta) => Some(meta),
        Err(err) => {
            eprintln!("failed to read data root meta {}: {err:#}", path.display());
            None
        }
    }
}

pub(super) fn write_meta(root: &Path, meta: &DataRootMeta) -> Result<()> {
    if !root.exists() {
        fs::create_dir_all(root)
            .with_context(|| format!("failed to create data root {}", root.display()))?;
    }
    let path = meta_path(root);
    write_json_file(&path, meta)
}

fn meta_preference(meta: &DataRootMeta) -> Option<(DataRootMode, u64)> {
    meta.desired_mode
        .map(|mode| (mode, meta.last_selected_at_ms.unwrap_or(0)))
}

pub(super) fn pick_meta_mode(
    system: Option<DataRootMeta>,
    portable: Option<DataRootMeta>,
) -> Option<DataRootMode> {
    let system_pref = system.as_ref().and_then(meta_preference);
    let portable_pref = portable.as_ref().and_then(meta_preference);
    match (system_pref, portable_pref) {
        (Some((mode_a, ts_a)), Some((mode_b, ts_b))) => {
            if ts_b > ts_a {
                Some(mode_b)
            } else if ts_a > ts_b {
                Some(mode_a)
            } else {
                Some(mode_b)
            }
        }
        (Some((mode, _)), None) => Some(mode),
        (None, Some((mode, _))) => Some(mode),
        (None, None) => None,
    }
}
