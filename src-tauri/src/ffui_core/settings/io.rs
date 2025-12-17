use std::fs;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};

struct CachedExeInfo {
    dir: PathBuf,
    stem: String,
}

static CACHED_EXE_INFO: OnceCell<CachedExeInfo> = OnceCell::new();

fn cached_exe_info() -> Result<&'static CachedExeInfo> {
    CACHED_EXE_INFO.get_or_try_init(|| {
        let exe = std::env::current_exe().context("failed to resolve current executable")?;
        // `current_exe()` is expected to return an absolute path, but in some
        // environments it can be relative. Persisting a relative dir would make
        // all sidecar paths sensitive to later `set_current_dir` calls in tests.
        let exe = if exe.is_absolute() {
            exe
        } else {
            // Prefer the OS-reported absolute executable path when available,
            // so we do not depend on the current working directory at the time
            // the cache is first initialized.
            #[cfg(unix)]
            if let Ok(link) = std::fs::read_link("/proc/self/exe") {
                link
            } else {
                std::env::current_dir()
                    .context("failed to resolve current working directory")?
                    .join(exe)
            }
            #[cfg(not(unix))]
            {
                std::env::current_dir()
                    .context("failed to resolve current working directory")?
                    .join(exe)
            }
        };
        let exe = exe.canonicalize().unwrap_or(exe);
        let dir = exe
            .parent()
            .map(Path::to_path_buf)
            .context("failed to resolve executable directory")?;
        let stem = exe
            .file_stem()
            .and_then(|s| s.to_str())
            .context("failed to resolve executable stem")?
            .to_string();
        Ok(CachedExeInfo { dir, stem })
    })
}

/// Resolves the path to a sidecar executable next to the current executable.
///
/// # Arguments
///
/// * `suffix` - The file extension/suffix for the sidecar executable
///
/// # Returns
///
/// A `Result<PathBuf>` containing the path to the sidecar executable or an error if
/// the current executable path cannot be resolved.
pub(super) fn executable_sidecar_path(suffix: &str) -> Result<PathBuf> {
    let info = cached_exe_info()?;
    Ok(info.dir.join(format!("{}.{suffix}", info.stem)))
}

/// Reads and deserializes a JSON file into the specified type.
///
/// # Arguments
///
/// * `path` - The path to the JSON file to read
///
/// # Returns
///
/// A `Result<T>` containing the deserialized value or an error if reading or parsing fails.
pub(super) fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let file = fs::File::open(path)
        .with_context(|| format!("failed to open config file {}", path.display()))?;
    let reader = BufReader::new(file);
    serde_json::from_reader(reader)
        .with_context(|| format!("failed to parse JSON from {}", path.display()))
}

/// Writes and serializes a value to a JSON file atomically.
///
/// Creates the parent directory if it doesn't exist, writes to a temporary file first,
/// then atomically renames it to the target path to ensure data consistency.
///
/// # Arguments
///
/// * `path` - The path where the JSON file should be written
/// * `value` - The value to serialize and write
///
/// # Returns
///
/// A `Result<()>` indicating success or an error if any step fails.
pub(super) fn write_json_file<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    let tmp_path = path.with_extension("tmp");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    {
        let file = fs::File::create(&tmp_path)
            .with_context(|| format!("failed to create temp file {}", tmp_path.display()))?;
        let mut writer = std::io::BufWriter::new(&file);
        serde_json::to_writer_pretty(&mut writer, value)
            .with_context(|| format!("failed to write JSON to {}", tmp_path.display()))?;
        writer
            .flush()
            .with_context(|| format!("failed to flush {}", tmp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("failed to sync {}", tmp_path.display()))?;
    }
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "failed to atomically rename {} -> {}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}
