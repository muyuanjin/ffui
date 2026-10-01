use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::ffui_core::domain::{AudioMediaInfo, MediaInfo};
use crate::ffui_core::settings::ExternalToolSettings;
use crate::ffui_core::tools::{ExternalToolKind, resolve_tool_path};
use crate::process_ext::{
    run_command_with_timeout_capture_stderr, run_command_with_timeout_capture_stdout,
};
use crate::sync_ext::MutexExt;

use super::ffmpeg_args::configure_background_command;

pub(super) struct ProbedMedia {
    pub info: MediaInfo,
    pub audio_duration: Option<f64>,
    pub cover_stream: Option<u64>,
}

fn positive_number(value: &Value) -> Option<f64> {
    let number = value.as_f64().or_else(|| value.as_str()?.parse().ok())?;
    (number.is_finite() && number > 0.0).then_some(number)
}

fn duration_span(audio: &Value, format: &Value) -> Option<f64> {
    let zero_origin = [audio, format].into_iter().all(|source| {
        source["start_time"]
            .as_f64()
            .or_else(|| source["start_time"].as_str()?.parse().ok())
            .is_none_or(|origin| origin == 0.0)
    });
    if !zero_origin && format["format_name"] != "mp3" {
        return None;
    }
    positive_number(&audio["duration"]).or_else(|| positive_number(&format["duration"]))
}

fn tag(format: &Value, stream: &Value, name: &str) -> Option<String> {
    [format, stream].into_iter().find_map(|source| {
        source
            .get("tags")?
            .as_object()?
            .iter()
            .find_map(|(key, value)| {
                key.eq_ignore_ascii_case(name)
                    .then(|| value.as_str().map(str::to_string))
                    .flatten()
            })
    })
}

pub(super) fn parse_media(raw: &Value) -> Option<ProbedMedia> {
    let streams = raw.get("streams")?.as_array()?;
    let audio_streams: Vec<_> = streams
        .iter()
        .filter(|stream| stream["codec_type"] == "audio")
        .collect();
    let audio = *audio_streams.first()?;
    let format = &raw["format"];
    let attached_picture = |stream: &&Value| {
        stream["codec_type"] == "video" && stream["disposition"]["attached_pic"] == 1
    };
    let has_video = streams
        .iter()
        .any(|stream| stream["codec_type"] == "video" && !attached_picture(&stream));
    if has_video {
        return None;
    }
    let duration = duration_span(audio, format);
    let audio_only = audio_streams.len() == 1
        && streams
            .iter()
            .all(|stream| stream["codec_type"] == "audio" || attached_picture(&stream));
    Some(ProbedMedia {
        info: MediaInfo {
            duration_seconds: duration,
            width: None,
            height: None,
            frame_rate: None,
            video_codec: None,
            audio_codec: audio["codec_name"].as_str().map(str::to_string),
            audio: Some(AudioMediaInfo {
                sample_rate_hz: positive_number(&audio["sample_rate"])
                    .and_then(|number| u32::try_from(number as u64).ok()),
                channels: audio["channels"]
                    .as_u64()
                    .and_then(|number| u32::try_from(number).ok()),
                bit_rate_kbps: positive_number(&audio["bit_rate"])
                    .or_else(|| positive_number(&format["bit_rate"]))
                    .map(|rate| rate / 1000.0),
                title: tag(format, audio, "title"),
                artist: tag(format, audio, "artist"),
                album: tag(format, audio, "album"),
            }),
            size_mb: positive_number(&format["size"]).map(|size| size / (1024.0 * 1024.0)),
        },
        audio_duration: audio_only.then_some(duration).flatten(),
        cover_stream: streams
            .iter()
            .find(attached_picture)
            .and_then(|stream| stream["index"].as_u64()),
    })
}

pub(super) fn probe_audio(input: &Path, tools: &ExternalToolSettings) -> Option<ProbedMedia> {
    if !input.is_file() {
        return None;
    }
    let (program, _) = resolve_tool_path(ExternalToolKind::Ffprobe, tools).ok()?;
    let mut command = Command::new(program);
    configure_background_command(&mut command);
    command
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(input);
    let (status, timed_out, stdout) =
        run_command_with_timeout_capture_stdout(command, Duration::from_secs(5), 256 * 1024)
            .ok()?;
    if timed_out || !status.success() {
        return None;
    }
    parse_media(&serde_json::from_slice(&stdout).ok()?)
}

pub(super) fn audio_cover(input: &Path, ffmpeg: &str, stream: u64) -> Option<PathBuf> {
    let metadata = std::fs::metadata(input).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata.modified().ok().hash(&mut hasher);
    stream.hash(&mut hasher);
    let root = crate::ffui_core::previews_dir().ok()?.join("audio-covers");
    std::fs::create_dir_all(&root).ok()?;
    let output = root.join(format!("{:016x}.jpg", hasher.finish()));
    let inflight =
        crate::ffui_core::preview_common::acquire_inflight_lock(&output.to_string_lossy());
    let _guard = inflight.lock_unpoisoned();
    if crate::ffui_core::preview_common::is_non_empty_regular_file(&output) {
        return Some(output);
    }
    let temporary = tempfile::Builder::new()
        .prefix(".cover-")
        .suffix(".jpg")
        .tempfile_in(&root)
        .ok()?
        .into_temp_path();
    let mut command = Command::new(ffmpeg);
    configure_background_command(&mut command);
    command
        .args(["-y", "-v", "error", "-nostdin", "-i"])
        .arg(input)
        .args([
            "-map",
            &format!("0:{stream}"),
            "-an",
            "-frames:v",
            "1",
            "-vf",
            "scale=180:180:force_original_aspect_ratio=decrease",
            "-f",
            "image2",
        ])
        .arg(&temporary);
    let (status, timed_out, _) =
        run_command_with_timeout_capture_stderr(command, Duration::from_secs(5), 1024).ok()?;
    if timed_out
        || !status.success()
        || !crate::ffui_core::preview_common::is_non_empty_regular_file(&temporary)
    {
        return None;
    }
    temporary.persist_noclobber(&output).ok()?;
    Some(output)
}

#[cfg(test)]
mod tests;
