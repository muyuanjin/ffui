use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result};

fn truncate_for_error(s: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut out = String::new();
    for (idx, ch) in s.chars().enumerate() {
        if idx >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn parse_ffprobe_format_duration_seconds(
    source: &Path,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<f64> {
    let stdout_s = String::from_utf8_lossy(stdout);
    let stderr_s = String::from_utf8_lossy(stderr);

    let first_non_empty = stdout_s
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or_default()
        .to_string();

    if first_non_empty.is_empty() {
        return Err(anyhow::anyhow!(
            "ffprobe returned empty stdout for {} (stderr: {})",
            source.display(),
            truncate_for_error(&stderr_s, 512)
        ));
    }

    let parsed: f64 = first_non_empty.parse().with_context(|| {
        format!(
            "ffprobe returned an unparsable duration for {} (stdout: {}, stderr: {})",
            source.display(),
            truncate_for_error(&first_non_empty, 128),
            truncate_for_error(&stderr_s, 512)
        )
    })?;

    if !parsed.is_finite() || parsed <= 0.0 {
        return Err(anyhow::anyhow!(
            "ffprobe returned a non-positive or non-finite duration for {}: {} (stderr: {})",
            source.display(),
            truncate_for_error(&first_non_empty, 128),
            truncate_for_error(&stderr_s, 512)
        ));
    }

    Ok(parsed)
}

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

    parse_ffprobe_format_duration_seconds(source, &output.stdout, &output.stderr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffprobe_duration_parses_first_non_empty_line() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("source.mp4");
        let got =
            parse_ffprobe_format_duration_seconds(&path, b"\n  12.5 \n", b"").expect("duration ok");
        assert!((got - 12.5).abs() < 0.000_001);
    }

    #[test]
    fn ffprobe_duration_rejects_unparsable_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("source.mp4");
        let err = parse_ffprobe_format_duration_seconds(&path, b"N/A\n", b"")
            .expect_err("unparsable duration must error");
        let msg = format!("{err:#}");
        assert!(msg.contains(&path.display().to_string()));
        assert!(msg.contains("unparsable"));
    }

    #[test]
    fn ffprobe_duration_rejects_empty_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("source.mp4");
        let err = parse_ffprobe_format_duration_seconds(&path, b"", b"")
            .expect_err("empty stdout must error");
        let msg = format!("{err:#}");
        assert!(msg.contains("empty stdout"));
    }

    #[test]
    fn ffprobe_duration_rejects_non_positive_duration() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("source.mp4");
        let err = parse_ffprobe_format_duration_seconds(&path, b"0\n", b"")
            .expect_err("0 duration must error");
        let msg = format!("{err:#}");
        assert!(msg.contains("non-positive") || msg.contains("non-finite"));
    }
}
