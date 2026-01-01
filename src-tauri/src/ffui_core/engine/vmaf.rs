use std::path::Path;
use std::process::Command;
use std::time::Duration;

use anyhow::{Context, Result, bail};

const STDERR_CAPTURE_LIMIT: usize = 4 * 1024 * 1024;

fn parse_vmaf_mean_from_stderr(stderr: &str) -> Option<f64> {
    // ffmpeg prints: "[Parsed_libvmaf_4 @ ...] VMAF score: 94.617780"
    for line in stderr.lines().rev() {
        let idx = line.rfind("VMAF score:")?;
        let tail = line[(idx + "VMAF score:".len())..].trim();
        if tail.is_empty() {
            continue;
        }
        let token = tail.split_whitespace().next().unwrap_or("").trim();
        let value = token.parse::<f64>().ok()?;
        if value.is_finite() {
            return Some(value);
        }
    }
    None
}

pub(crate) struct VmafMeasureOptions {
    pub trim_seconds: Option<f64>,
    pub timeout: Duration,
}

pub(crate) fn measure_vmaf_mean_with_ffmpeg(
    ffmpeg_program: &str,
    reference_path: &Path,
    distorted_path: &Path,
    options: VmafMeasureOptions,
) -> Result<f64> {
    if !reference_path.is_file() {
        bail!(
            "reference video does not exist: {}",
            reference_path.display()
        );
    }
    if !distorted_path.is_file() {
        bail!(
            "distorted video does not exist: {}",
            distorted_path.display()
        );
    }

    let filter = [
        // Align timelines.
        "[0:v]setpts=PTS-STARTPTS[ref0]",
        "[1:v]setpts=PTS-STARTPTS[dist0]",
        // Scale distorted to match reference resolution (VMAF requires same size).
        "[dist0][ref0]scale2ref[dist1][ref1]",
        // Normalize pixel format for a stable baseline.
        "[dist1]format=yuv420p[dist]",
        "[ref1]format=yuv420p[ref]",
        // Note: libvmaf expects [dist][ref] order.
        "[dist][ref]libvmaf=log_fmt=json",
    ]
    .join(";");

    let mut args: Vec<String> = vec!["-hide_banner".to_string(), "-nostdin".to_string()];

    if let Some(t) = options.trim_seconds
        && t.is_finite()
        && t > 0.0
    {
        args.push("-t".to_string());
        args.push(t.to_string());
    }

    args.extend_from_slice(&[
        "-i".to_string(),
        reference_path.to_string_lossy().into_owned(),
    ]);

    if let Some(t) = options.trim_seconds
        && t.is_finite()
        && t > 0.0
    {
        args.push("-t".to_string());
        args.push(t.to_string());
    }

    args.extend_from_slice(&[
        "-i".to_string(),
        distorted_path.to_string_lossy().into_owned(),
        // Avoid decoding/mapping audio/subtitles; we only need video frames.
        "-an".to_string(),
        "-sn".to_string(),
        "-lavfi".to_string(),
        filter,
        "-f".to_string(),
        "null".to_string(),
        "-".to_string(),
    ]);

    let mut cmd = Command::new(ffmpeg_program);
    cmd.args(&args);
    super::configure_background_command(&mut cmd);
    let (status, timed_out, stderr_bytes) =
        crate::process_ext::run_command_with_timeout_capture_stderr(
            cmd,
            options.timeout,
            STDERR_CAPTURE_LIMIT,
        )
        .with_context(|| {
            format!(
                "failed to spawn ffmpeg for VMAF: {}",
                reference_path.display()
            )
        })?;

    let stderr_text = String::from_utf8_lossy(&stderr_bytes);

    if timed_out {
        bail!("ffmpeg timed out while computing VMAF");
    }

    if !status.success() {
        let tail = stderr_text
            .lines()
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        bail!("ffmpeg exited with non-zero status while computing VMAF: {tail}");
    }

    parse_vmaf_mean_from_stderr(&stderr_text)
        .context("failed to parse VMAF score from ffmpeg output")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_vmaf_mean_from_stderr_finds_last_score() {
        let stderr = "\nfoo\n[Parsed_libvmaf_0 @ 0] VMAF score: 91.234\nbar\n[Parsed_libvmaf_1 @ 0] VMAF score: 94.617780\n";
        let v = parse_vmaf_mean_from_stderr(stderr).expect("vmaf");
        assert!((v - 94.617780).abs() < 1e-9);
    }
}
