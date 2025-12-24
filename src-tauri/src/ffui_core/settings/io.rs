use std::fs;
use std::io::{BufReader, Write};
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Reads and deserializes a JSON file into the specified type.
///
/// # Arguments
///
/// * `path` - The path to the JSON file to read
///
/// # Returns
///
/// A `Result<T>` containing the deserialized value or an error if reading or parsing fails.
pub(crate) fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
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
pub(crate) fn write_json_file<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
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
