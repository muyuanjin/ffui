use std::path::{
    Path,
    PathBuf,
};

use anyhow::{
    Context,
    Result,
};
use tauri::Manager;

use super::meta::{
    DataRootMeta,
    meta_path,
    pick_meta_mode,
    read_meta,
    write_meta,
};
use super::{
    DataRootMode,
    DataRootState,
    META_FILENAME,
    PRESETS_FILENAME,
    QUEUE_LOGS_DIRNAME,
    QUEUE_STATE_FILENAME,
    SETTINGS_FILENAME,
    UI_FONTS_DIRNAME,
    now_ms,
};

#[derive(Debug, Clone)]
pub(super) struct DataRootContext {
    pub(super) system_root: PathBuf,
    pub(super) portable_root: PathBuf,
    pub(super) exe_dir: PathBuf,
    pub(super) exe_name: String,
}

fn portable_root_has_marker(portable_root: &Path) -> bool {
    let candidates = [
        portable_root.join(SETTINGS_FILENAME),
        portable_root.join(PRESETS_FILENAME),
        portable_root.join(QUEUE_STATE_FILENAME),
        portable_root.join(META_FILENAME),
    ];
    if candidates.iter().any(|p| p.exists()) {
        return true;
    }
    let logs = portable_root.join(QUEUE_LOGS_DIRNAME);
    logs.exists() || portable_root.join(UI_FONTS_DIRNAME).exists()
}

fn exe_name_is_portable(exe_name: &str) -> bool {
    exe_name.to_ascii_lowercase().contains("-portable")
}

fn default_desired_mode(context: &DataRootContext) -> DataRootMode {
    if portable_root_has_marker(&context.portable_root) {
        return DataRootMode::Portable;
    }
    if exe_name_is_portable(&context.exe_name) {
        return DataRootMode::Portable;
    }
    DataRootMode::System
}

pub(super) fn is_dir_writable(path: &Path) -> bool {
    use std::io::Write;

    if std::fs::create_dir_all(path).is_err() {
        return false;
    }

    let pid = std::process::id();
    for attempt in 0..16u32 {
        let probe_name = format!(".ffui-write-test-{pid}-{attempt}");
        let probe = path.join(&probe_name);
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe);

        match file {
            Ok(mut file) => {
                let result = file.write_all(b"ffui").is_ok() && file.flush().is_ok();
                drop(file);
                let _ = std::fs::remove_file(&probe);
                return result;
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return false,
        }
    }

    false
}

pub(super) fn resolve_data_root_with(
    context: &DataRootContext,
    probe_writable: impl Fn(&Path) -> bool,
) -> Result<DataRootState> {
    let system_meta = read_meta(&context.system_root);
    let portable_meta = read_meta(&context.portable_root);
    let desired_mode = pick_meta_mode(system_meta.clone(), portable_meta.clone())
        .unwrap_or_else(|| default_desired_mode(context));

    let portable_writable =
        matches!(desired_mode, DataRootMode::Portable) && probe_writable(&context.portable_root);
    let effective_mode = if matches!(desired_mode, DataRootMode::Portable) && portable_writable {
        DataRootMode::Portable
    } else {
        DataRootMode::System
    };
    let data_root = if matches!(effective_mode, DataRootMode::Portable) {
        context.portable_root.clone()
    } else {
        context.system_root.clone()
    };
    let fallback_active = matches!(desired_mode, DataRootMode::Portable)
        && matches!(effective_mode, DataRootMode::System);

    let fallback_notice_dismissed = if matches!(effective_mode, DataRootMode::Portable) {
        portable_meta
            .as_ref()
            .and_then(|meta| meta.fallback_notice_dismissed)
            .unwrap_or(false)
    } else {
        system_meta
            .as_ref()
            .and_then(|meta| meta.fallback_notice_dismissed)
            .unwrap_or(false)
    };

    let fallback_notice_pending = fallback_active && !fallback_notice_dismissed;

    if fallback_active && !fallback_notice_dismissed {
        let base_meta = system_meta.unwrap_or_default();
        let meta = DataRootMeta {
            schema_version: 1,
            desired_mode: Some(desired_mode),
            last_selected_at_ms: Some(base_meta.last_selected_at_ms.unwrap_or_else(now_ms)),
            fallback_notice_dismissed: Some(false),
        };
        if let Err(err) = write_meta(&context.system_root, &meta) {
            crate::debug_eprintln!(
                "failed to persist data root fallback meta {}: {err:#}",
                meta_path(&context.system_root).display()
            );
        }
    }

    Ok(DataRootState {
        desired_mode,
        effective_mode,
        fallback_active,
        fallback_notice_pending,
        data_root,
        system_root: context.system_root.clone(),
        portable_root: context.portable_root.clone(),
    })
}

fn portable_root_from_exe_path(exe_path: &Path) -> Result<PathBuf> {
    let exe_dir = exe_path
        .parent()
        .map(Path::to_path_buf)
        .context("failed to resolve executable directory")?;
    for ancestor in exe_dir.ancestors() {
        if ancestor
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
            && let Some(parent) = ancestor.parent()
        {
            return Ok(parent.to_path_buf());
        }
    }
    Ok(exe_dir)
}

pub(super) fn data_root_context_from_app(app: &tauri::AppHandle) -> Result<DataRootContext> {
    let system_root = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("failed to resolve app_data_dir: {e}"))?;
    let exe = std::env::current_exe().context("failed to resolve current executable")?;
    let exe_name = exe
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    let portable_root = portable_root_from_exe_path(&exe)?;
    let exe_dir = exe
        .parent()
        .map(Path::to_path_buf)
        .context("failed to resolve executable directory")?;
    Ok(DataRootContext {
        system_root,
        portable_root,
        exe_dir,
        exe_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_dir_writable_does_not_overwrite_existing_probe_file() {
        let pid = std::process::id();
        let root = std::env::temp_dir().join(format!(
            "ffui-test-is-dir-writable-{pid}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create temp dir");

        let existing_probe = root.join(format!(".ffui-write-test-{pid}-0"));
        std::fs::write(&existing_probe, b"DO_NOT_OVERWRITE").expect("seed probe");

        let result = is_dir_writable(&root);
        assert!(result);

        let content = std::fs::read(&existing_probe).expect("read seeded probe");
        assert_eq!(content, b"DO_NOT_OVERWRITE");

        let mut probe_files: Vec<String> = std::fs::read_dir(&root)
            .expect("read_dir")
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.starts_with(".ffui-write-test-"))
            .collect();
        probe_files.sort();
        assert_eq!(probe_files, vec![format!(".ffui-write-test-{pid}-0")]);

        let _ = std::fs::remove_file(&existing_probe);
        let _ = std::fs::remove_dir_all(&root);
    }
}
