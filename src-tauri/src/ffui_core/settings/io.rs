use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

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
    let exe = std::env::current_exe().context("failed to resolve current executable")?;
    let dir = exe
        .parent()
        .map(Path::to_path_buf)
        .context("failed to resolve executable directory")?;
    let stem = exe
        .file_stem()
        .and_then(|s| s.to_str())
        .context("failed to resolve executable stem")?;
    Ok(dir.join(format!("{stem}.{suffix}")))
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
    let file = fs::File::create(&tmp_path)
        .with_context(|| format!("failed to create temp file {}", tmp_path.display()))?;
    serde_json::to_writer_pretty(&file, value)
        .with_context(|| format!("failed to write JSON to {}", tmp_path.display()))?;
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "failed to atomically rename {} -> {}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}
