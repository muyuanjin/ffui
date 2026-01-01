use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::ffui_core::TranscodingEngine;
use crate::ffui_core::domain::FFmpegPreset;
use crate::ffui_core::engine::{
    build_ffmpeg_args, split_template_args, strip_leading_ffmpeg_program,
};
use crate::ffui_core::tools::{ExternalToolKind, resolve_tool_path};

#[path = "template_validation_sample_mp4.rs"]
mod template_validation_sample_mp4;
use template_validation_sample_mp4::SAMPLE_MP4_BYTES;

const DEFAULT_TIMEOUT_MS: u64 = 800;
const STDERR_CAPTURE_LIMIT: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PresetTemplateValidationOutcome {
    Ok,
    Failed,
    TimedOut,
    SkippedToolUnavailable,
    TemplateInvalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetTemplateValidationResult {
    pub outcome: PresetTemplateValidationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ffmpeg_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn validate_template_placeholders(template: &str) -> Result<(), String> {
    let mut args = split_template_args(template);
    strip_leading_ffmpeg_program(&mut args);

    let input_count = args.iter().filter(|a| a.as_str() == "INPUT").count();
    if input_count != 1 {
        return Err(if input_count == 0 {
            "missing INPUT placeholder".to_string()
        } else {
            "multiple INPUT placeholders are not supported".to_string()
        });
    }

    let output_count = args.iter().filter(|a| a.as_str() == "OUTPUT").count();
    if output_count != 1 {
        return Err(if output_count == 0 {
            "missing OUTPUT placeholder".to_string()
        } else {
            "multiple OUTPUT placeholders are not supported".to_string()
        });
    }

    Ok(())
}

fn summarize_stderr(stderr: &str) -> Option<String> {
    let mut lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter(|l| {
            !matches!(*l, "progress=continue" | "progress=end") && !l.starts_with("out_time_ms=")
        })
        .collect();

    if lines.is_empty() {
        return None;
    }

    // Avoid huge UI payloads; keep a compact “first/last” summary.
    const KEEP: usize = 3;
    if lines.len() <= KEEP * 2 {
        return Some(lines.join("\n"));
    }
    let head = lines.drain(..KEEP).collect::<Vec<_>>();
    let tail = lines
        .drain(lines.len().saturating_sub(KEEP)..)
        .collect::<Vec<_>>();
    let mut out: Vec<&str> = Vec::with_capacity(KEEP * 2 + 1);
    out.extend(head);
    out.push("…");
    out.extend(tail);
    Some(out.join("\n"))
}

fn run_with_timeout(
    ffmpeg_program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<(ExitStatus, bool, Vec<u8>), std::io::Error> {
    let mut child = Command::new(ffmpeg_program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stderr = child.stderr.take();
    let stderr_handle = std::thread::spawn(move || {
        let Some(mut stderr) = stderr.take() else {
            return Vec::<u8>::new();
        };

        let mut captured: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = match stderr.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            if captured.len() < STDERR_CAPTURE_LIMIT {
                let remaining = STDERR_CAPTURE_LIMIT - captured.len();
                let to_copy = remaining.min(n);
                captured.extend_from_slice(&buf[..to_copy]);
            }
        }
        captured
    });

    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() >= timeout {
            timed_out = true;
            drop(child.kill());
            break child.wait()?;
        }
        std::thread::sleep(Duration::from_millis(10));
    };

    let stderr_bytes = stderr_handle.join().unwrap_or_default();
    Ok((status, timed_out, stderr_bytes))
}

pub(crate) fn validate_preset_template_with_program(
    preset: &FFmpegPreset,
    ffmpeg_program: &str,
    ffmpeg_source: Option<String>,
    timeout_ms: Option<u64>,
) -> PresetTemplateValidationResult {
    let timeout_ms = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).max(1);

    let template = preset.ffmpeg_template.as_deref().unwrap_or("").trim();
    if !preset.advanced_enabled.unwrap_or(false) || template.is_empty() {
        return PresetTemplateValidationResult {
            outcome: PresetTemplateValidationOutcome::TemplateInvalid,
            ffmpeg_path: Some(ffmpeg_program.to_string()),
            ffmpeg_source,
            exit_code: None,
            stderr_summary: None,
            message: Some("preset is not in template mode".to_string()),
        };
    }

    if let Err(reason) = validate_template_placeholders(template) {
        return PresetTemplateValidationResult {
            outcome: PresetTemplateValidationOutcome::TemplateInvalid,
            ffmpeg_path: Some(ffmpeg_program.to_string()),
            ffmpeg_source,
            exit_code: None,
            stderr_summary: None,
            message: Some(reason),
        };
    }

    let dir = {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let dir = std::env::temp_dir().join(format!(
            "ffui-template-validate-{}-{nonce}",
            std::process::id()
        ));
        if let Err(err) = std::fs::create_dir_all(&dir) {
            return PresetTemplateValidationResult {
                outcome: PresetTemplateValidationOutcome::Failed,
                ffmpeg_path: Some(ffmpeg_program.to_string()),
                ffmpeg_source,
                exit_code: None,
                stderr_summary: None,
                message: Some(format!("failed to create validation temp dir: {err}")),
            };
        }
        dir
    };

    let input_path = dir.join("ffui-sample.mp4");
    if let Err(err) = std::fs::write(&input_path, SAMPLE_MP4_BYTES.as_slice()) {
        return PresetTemplateValidationResult {
            outcome: PresetTemplateValidationOutcome::Failed,
            ffmpeg_path: Some(ffmpeg_program.to_string()),
            ffmpeg_source,
            exit_code: None,
            stderr_summary: None,
            message: Some(format!("failed to write sample input: {err}")),
        };
    }

    let output_path = dir.join("ffui-out.mp4");
    let args = build_ffmpeg_args(preset, &input_path, &output_path, true, None);

    let (status, timed_out, stderr_bytes) =
        match run_with_timeout(ffmpeg_program, &args, Duration::from_millis(timeout_ms)) {
            Ok(out) => out,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return PresetTemplateValidationResult {
                    outcome: PresetTemplateValidationOutcome::SkippedToolUnavailable,
                    ffmpeg_path: Some(ffmpeg_program.to_string()),
                    ffmpeg_source,
                    exit_code: None,
                    stderr_summary: None,
                    message: Some("ffmpeg executable not found".to_string()),
                };
            }
            Err(err) => {
                return PresetTemplateValidationResult {
                    outcome: PresetTemplateValidationOutcome::Failed,
                    ffmpeg_path: Some(ffmpeg_program.to_string()),
                    ffmpeg_source,
                    exit_code: None,
                    stderr_summary: None,
                    message: Some(format!("failed to spawn ffmpeg: {err}")),
                };
            }
        };

    let stderr_text = String::from_utf8_lossy(&stderr_bytes);
    let stderr_summary = summarize_stderr(&stderr_text);
    let exit_code = status.code();

    if timed_out {
        return PresetTemplateValidationResult {
            outcome: PresetTemplateValidationOutcome::TimedOut,
            ffmpeg_path: Some(ffmpeg_program.to_string()),
            ffmpeg_source,
            exit_code,
            stderr_summary,
            message: Some("ffmpeg did not exit before timeout".to_string()),
        };
    }

    if status.success() {
        return PresetTemplateValidationResult {
            outcome: PresetTemplateValidationOutcome::Ok,
            ffmpeg_path: Some(ffmpeg_program.to_string()),
            ffmpeg_source,
            exit_code,
            stderr_summary,
            message: None,
        };
    }

    PresetTemplateValidationResult {
        outcome: PresetTemplateValidationOutcome::Failed,
        ffmpeg_path: Some(ffmpeg_program.to_string()),
        ffmpeg_source,
        exit_code,
        stderr_summary,
        message: Some("ffmpeg exited with non-zero status".to_string()),
    }
}

pub(crate) fn validate_preset_template(
    engine: &TranscodingEngine,
    preset: FFmpegPreset,
    timeout_ms: Option<u64>,
) -> PresetTemplateValidationResult {
    let tools = engine.settings().tools;
    let (path, source) = resolve_tool_path(ExternalToolKind::Ffmpeg, &tools)
        .unwrap_or_else(|_| ("ffmpeg".to_string(), "path".to_string()));
    validate_preset_template_with_program(&preset, &path, Some(source), timeout_ms)
}

#[cfg(test)]
mod tests;
