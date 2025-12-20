use std::fs;
use std::path::{
    Path,
    PathBuf,
};
use std::time::{
    SystemTime,
    UNIX_EPOCH,
};

use super::{
    DataRootState,
    PRESETS_FILENAME,
    QUEUE_LOGS_DIRNAME,
    QUEUE_STATE_FILENAME,
    SETTINGS_FILENAME,
    TOOLS_DIRNAME,
};

fn legacy_candidates_with_suffix(exe_dir: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(exe_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|s| s.to_str())
            && name.ends_with(suffix)
            && path.is_file()
        {
            out.push(path);
        }
    }
    out
}

fn legacy_dir_candidates_with_suffix(exe_dir: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(exe_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|s| s.to_str())
            && name.ends_with(suffix)
        {
            out.push(path);
        }
    }
    out
}

fn pick_most_recent(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut best: Option<(PathBuf, SystemTime)> = None;
    for path in paths {
        let modified = path
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(UNIX_EPOCH);
        match &best {
            Some((_, best_time)) if *best_time >= modified => {}
            _ => {
                best = Some((path.clone(), modified));
            }
        }
    }
    best.map(|(path, _)| path)
}

fn copy_file_if_missing(source: &Path, dest: &Path) {
    if dest.exists() {
        return;
    }
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::copy(source, dest);
}

fn copy_dir_files_if_missing(source: &Path, dest: &Path) {
    if dest.exists() {
        return;
    }
    if let Err(err) = fs::create_dir_all(dest) {
        eprintln!("failed to create data root dir {}: {err:#}", dest.display());
        return;
    }
    let Ok(entries) = fs::read_dir(source) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(name) = path.file_name() {
            let _ = fs::copy(&path, dest.join(name));
        }
    }
}

pub(super) fn migrate_legacy_sidecars(state: &DataRootState, exe_dir: &Path) {
    let settings_candidates = legacy_candidates_with_suffix(exe_dir, ".settings.json");
    if let Some(source) = pick_most_recent(&settings_candidates)
        && !state.data_root.join(SETTINGS_FILENAME).exists()
    {
        copy_file_if_missing(&source, &state.data_root.join(SETTINGS_FILENAME));
    }

    let presets_candidates = legacy_candidates_with_suffix(exe_dir, ".presets.json");
    if let Some(source) = pick_most_recent(&presets_candidates)
        && !state.data_root.join(PRESETS_FILENAME).exists()
    {
        copy_file_if_missing(&source, &state.data_root.join(PRESETS_FILENAME));
    }

    let queue_candidates = legacy_candidates_with_suffix(exe_dir, ".queue-state.json");
    if let Some(source) = pick_most_recent(&queue_candidates)
        && !state.data_root.join(QUEUE_STATE_FILENAME).exists()
    {
        copy_file_if_missing(&source, &state.data_root.join(QUEUE_STATE_FILENAME));
    }

    let log_candidates = legacy_dir_candidates_with_suffix(exe_dir, ".queue-logs");
    if let Some(source) = pick_most_recent(&log_candidates)
        && source.is_dir()
        && !state.data_root.join(QUEUE_LOGS_DIRNAME).exists()
    {
        copy_dir_files_if_missing(&source, &state.data_root.join(QUEUE_LOGS_DIRNAME));
    }

    let tools = exe_dir.join(TOOLS_DIRNAME);
    if tools.is_dir() && !state.data_root.join(TOOLS_DIRNAME).exists() {
        copy_dir_files_if_missing(&tools, &state.data_root.join(TOOLS_DIRNAME));
    }
}

pub(super) fn migrate_data_root_snapshot(source_root: &Path, target_root: &Path) {
    let files = [SETTINGS_FILENAME, PRESETS_FILENAME, QUEUE_STATE_FILENAME];
    for name in files {
        let source = source_root.join(name);
        let dest = target_root.join(name);
        if source.is_file() {
            copy_file_if_missing(&source, &dest);
        }
    }

    let logs = source_root.join(QUEUE_LOGS_DIRNAME);
    let logs_dest = target_root.join(QUEUE_LOGS_DIRNAME);
    if logs.is_dir() {
        copy_dir_files_if_missing(&logs, &logs_dest);
    }

    let tools = source_root.join(TOOLS_DIRNAME);
    let tools_dest = target_root.join(TOOLS_DIRNAME);
    if tools.is_dir() {
        copy_dir_files_if_missing(&tools, &tools_dest);
    }
}
