use std::collections::HashMap;
use std::process::Command;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use once_cell::sync::Lazy;

const STDERR_CAPTURE_LIMIT: usize = 256 * 1024;
const DEFAULT_TTL: Duration = Duration::from_secs(30);

#[cfg(windows)]
fn configure_background_command(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
}

#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut Command) {}

fn stderr_tail(stderr: &str, max_lines: usize) -> String {
    stderr
        .lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone, Debug)]
struct ProbeCacheEntry {
    ok: bool,
    stderr_tail: String,
    at: Instant,
}

static ENCODER_PROBE_CACHE: Lazy<std::sync::Mutex<HashMap<(String, String), ProbeCacheEntry>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

static FILTER_HELP_CACHE: Lazy<std::sync::Mutex<HashMap<(String, String), ProbeCacheEntry>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

pub(crate) fn ensure_ffmpeg_filter_help_available(
    ffmpeg_program: &str,
    filter_name: &str,
) -> Result<()> {
    let key = (ffmpeg_program.to_string(), filter_name.to_string());
    if let Ok(cache) = FILTER_HELP_CACHE.lock()
        && let Some(hit) = cache.get(&key)
        && hit.at.elapsed() < DEFAULT_TTL
    {
        if hit.ok {
            return Ok(());
        }
        bail!(
            "ffmpeg filter help probe failed: filter={filter_name}\n{}",
            hit.stderr_tail
        );
    }

    let mut cmd = Command::new(ffmpeg_program);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-h",
        &format!("filter={filter_name}"),
    ]);
    configure_background_command(&mut cmd);

    let (status, timed_out, stderr_bytes) =
        crate::process_ext::run_command_with_timeout_capture_stderr(
            cmd,
            Duration::from_secs(10),
            STDERR_CAPTURE_LIMIT,
        )
        .with_context(|| format!("failed to spawn ffmpeg for filter probe: {filter_name}"))?;

    let stderr = String::from_utf8_lossy(&stderr_bytes);
    let tail = stderr_tail(&stderr, 12);

    let ok = !timed_out && status.success();
    if let Ok(mut cache) = FILTER_HELP_CACHE.lock() {
        cache.insert(
            key,
            ProbeCacheEntry {
                ok,
                stderr_tail: tail.clone(),
                at: Instant::now(),
            },
        );
    }

    if timed_out {
        bail!("ffmpeg filter probe timed out: filter={filter_name}");
    }
    if !status.success() {
        bail!("ffmpeg filter help probe failed: filter={filter_name}\n{tail}");
    }
    Ok(())
}

pub(crate) fn ensure_ffmpeg_video_encoder_usable(
    ffmpeg_program: &str,
    encoder: &str,
) -> Result<()> {
    let key = (ffmpeg_program.to_string(), encoder.to_string());
    if let Ok(cache) = ENCODER_PROBE_CACHE.lock()
        && let Some(hit) = cache.get(&key)
        && hit.at.elapsed() < DEFAULT_TTL
    {
        if hit.ok {
            return Ok(());
        }
        return Err(anyhow!(
            "ffmpeg encoder probe failed: encoder={encoder}\n{}",
            hit.stderr_tail
        ));
    }

    let mut cmd = Command::new(ffmpeg_program);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x90:rate=10",
        "-frames:v",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        encoder,
        "-f",
        "null",
        "-",
    ]);
    configure_background_command(&mut cmd);

    let (status, timed_out, stderr_bytes) =
        crate::process_ext::run_command_with_timeout_capture_stderr(
            cmd,
            Duration::from_secs(30),
            STDERR_CAPTURE_LIMIT,
        )
        .with_context(|| format!("failed to spawn ffmpeg for encoder probe: {encoder}"))?;

    let stderr = String::from_utf8_lossy(&stderr_bytes);
    let tail = stderr_tail(&stderr, 12);

    let ok = !timed_out && status.success();
    if let Ok(mut cache) = ENCODER_PROBE_CACHE.lock() {
        cache.insert(
            key,
            ProbeCacheEntry {
                ok,
                stderr_tail: tail.clone(),
                at: Instant::now(),
            },
        );
    }

    if timed_out {
        bail!("ffmpeg encoder probe timed out: encoder={encoder}");
    }
    if !status.success() {
        bail!("ffmpeg encoder probe failed: encoder={encoder}\n{tail}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stderr_tail_keeps_last_lines() {
        let s = "a\nb\nc\nd\ne\n";
        assert_eq!(stderr_tail(s, 2), "d\ne");
        assert_eq!(stderr_tail(s, 10), "a\nb\nc\nd\ne");
    }
}
