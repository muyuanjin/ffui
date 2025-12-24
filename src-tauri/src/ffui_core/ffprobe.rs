use std::path::Path;
use std::process::Command;

use anyhow::{
    Context,
    Result,
};

pub(crate) fn ffprobe_format_duration_seconds(
    ffprobe_path: &Path,
    source: &Path,
    configure: fn(&mut Command),
) -> Result<f64> {
    let mut cmd = Command::new(ffprobe_path);
    configure(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=nw=1:nk=1")
        .arg(source.as_os_str())
        .output()
        .with_context(|| format!("failed to run ffprobe for duration on {}", source.display()))?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed for {}: {}",
            source.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let s = String::from_utf8_lossy(&output.stdout);
    let first = s.lines().next().unwrap_or_default().trim();
    Ok(first.parse().unwrap_or(0.0))
}
