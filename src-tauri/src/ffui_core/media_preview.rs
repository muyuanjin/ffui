use std::ffi::OsString;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::preview_common::{
    acquire_inflight_lock, configure_background_command, file_fingerprint, hash_key,
    is_non_empty_regular_file,
};
use super::settings::ExternalToolSettings;
use super::tools::{ExternalToolKind, ensure_tool_available};
use crate::sync_ext::MutexExt;

const MAX_PREVIEW_BYTES: u64 = 256 * 1024 * 1024;
mod cache;
mod image_alpha;

#[derive(Clone, Copy)]
struct PreviewLimits {
    output_bytes: u64,
    cache_bytes: u64,
    timeout: Duration,
}

impl Default for PreviewLimits {
    fn default() -> Self {
        Self {
            output_bytes: MAX_PREVIEW_BYTES,
            cache_bytes: 512 * 1024 * 1024,
            timeout: Duration::from_secs(120),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PreviewMediaKind {
    Audio,
    Image,
    Video,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaPreviewInfo {
    pub kind: PreviewMediaKind,
    pub duration_seconds: Option<f64>,
}

struct PreviewChild(Child);

impl Drop for PreviewChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            drop(self.0.kill());
            drop(self.0.wait());
        }
    }
}

fn read_capture(file: &mut fs::File) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take(1024 * 1024).read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn run_preview_command(command: &mut Command, timeout: Duration) -> Result<Output> {
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    configure_background_command(command);
    let child = PreviewChild(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout.try_clone()?))
            .stderr(Stdio::from(stderr.try_clone()?))
            .spawn()
            .context("failed to launch media preview tool")?,
    );
    let status = wait_preview_child(child, timeout)?;
    Ok(Output {
        status,
        stdout: read_capture(&mut stdout)?,
        stderr: read_capture(&mut stderr)?,
    })
}

fn wait_preview_child(
    mut child: PreviewChild,
    timeout: Duration,
) -> Result<std::process::ExitStatus> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.0.try_wait()? {
            return Ok(status);
        }
        if started.elapsed() >= timeout {
            bail!(
                "media preview preparation timed out after {} seconds",
                timeout.as_secs()
            );
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn readable_source(source_path: &str) -> Result<&Path> {
    let source = Path::new(source_path);
    let metadata = fs::metadata(source)
        .with_context(|| format!("cannot read preview source: {}", source.display()))?;
    if !metadata.is_file() {
        bail!("preview source is not a file: {}", source.display());
    }
    Ok(source)
}

fn parse_preview_info(root: &Value) -> Result<MediaPreviewInfo> {
    let streams = root["streams"]
        .as_array()
        .context("media preview probe has no streams")?;
    let has_audio = streams.iter().any(|stream| stream["codec_type"] == "audio");
    let video = streams.iter().find(|stream| {
        stream["codec_type"] == "video" && stream["disposition"]["attached_pic"].as_u64() != Some(1)
    });
    let format = root["format"]["format_name"].as_str().unwrap_or_default();
    let brand = root["format"]["tags"]["major_brand"]
        .as_str()
        .unwrap_or_default();
    let image_format = matches!(
        brand,
        "avif" | "avis" | "heic" | "heix" | "hevc" | "hevx" | "mif1" | "msf1"
    ) || format.split(',').any(|name| {
        name.ends_with("_pipe")
            || matches!(
                name,
                "image2" | "image2pipe" | "avif" | "ico" | "gif" | "apng"
            )
    });
    let kind = if let Some(video) = video {
        if !has_audio && (image_format || video["disposition"]["still_image"].as_u64() == Some(1)) {
            PreviewMediaKind::Image
        } else {
            PreviewMediaKind::Video
        }
    } else if has_audio {
        PreviewMediaKind::Audio
    } else if image_format && streams.iter().any(|stream| stream["codec_type"] == "video") {
        PreviewMediaKind::Image
    } else {
        bail!("preview source contains no playable audio, image or video stream");
    };
    let duration = root["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .or_else(|| root["format"]["duration"].as_f64());
    Ok(MediaPreviewInfo {
        kind,
        duration_seconds: duration.filter(|value| value.is_finite() && *value > 0.0),
    })
}

pub(crate) fn probe_media_preview(
    source_path: &str,
    tools: &ExternalToolSettings,
) -> Result<MediaPreviewInfo> {
    let source = readable_source(source_path)?;
    let (ffprobe, _, _) = ensure_tool_available(ExternalToolKind::Ffprobe, tools)?;
    let output = run_preview_command(
        Command::new(ffprobe)
            .args([
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
            ])
            .arg(source),
        Duration::from_secs(20),
    )?;
    if !output.status.success() {
        bail!(
            "media preview probe failed for {} ({}): {}",
            source.display(),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let root: Value =
        serde_json::from_slice(&output.stdout).context("invalid media preview probe JSON")?;
    parse_preview_info(&root)
}

fn cache_root() -> Result<PathBuf> {
    Ok(super::previews_dir()?.join("playback-cache"))
}

pub(crate) fn clear_media_preview_cache() -> Result<()> {
    let root = cache_root()?;
    let lock = cache::lock(&root);
    let _guard = lock.lock_unpoisoned();
    cache::reclaim(&root, None, 0)
}

fn conversion_args(
    source: &Path,
    kind: PreviewMediaKind,
    output: &Path,
    max_bytes: u64,
) -> Result<Vec<OsString>> {
    let mut args: Vec<OsString> = [
        "-nostdin",
        "-y",
        "-hide_banner",
        "-v",
        "error",
        "-filter_threads",
        "1",
        "-i",
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    args.push(source.as_os_str().to_owned());
    let options = match kind {
        PreviewMediaKind::Audio => vec![
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            "-f",
            "ipod",
        ],
        PreviewMediaKind::Image => vec![
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            "-vf",
            "scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease",
            "-c:v",
            "png",
            "-pix_fmt",
            "rgba",
            "-f",
            "image2",
            "-update",
            "1",
        ],
        PreviewMediaKind::Video => bail!("video previews use native playback or frame scrubbing"),
    };
    args.extend(options.into_iter().map(OsString::from));
    args.extend(["-threads", "2"].into_iter().map(OsString::from));
    args.push("-fs".into());
    args.push(max_bytes.to_string().into());
    args.push(output.as_os_str().to_owned());
    Ok(args)
}

fn prepare_in_cache(
    source: &Path,
    kind: PreviewMediaKind,
    ffmpeg: &Path,
    root: &Path,
) -> Result<PathBuf> {
    prepare_in_cache_with_limits(source, kind, ffmpeg, root, PreviewLimits::default())
}

fn prepare_in_cache_with_limits(
    source: &Path,
    kind: PreviewMediaKind,
    ffmpeg: &Path,
    root: &Path,
    limits: PreviewLimits,
) -> Result<PathBuf> {
    let (size, modified) = file_fingerprint(source);
    if kind == PreviewMediaKind::Image {
        image_alpha::validate(source, ffmpeg)?;
    }
    let identity = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    let key = format!(
        "playback-v2:{kind:?}:{}:{size}:{modified:?}",
        identity.display()
    );
    let lock = acquire_inflight_lock(&key);
    let _guard = lock.lock_unpoisoned();
    let frames = root.join("frames");
    fs::create_dir_all(&frames)?;
    let extension = match kind {
        PreviewMediaKind::Audio => "m4a",
        PreviewMediaKind::Image => "png",
        PreviewMediaKind::Video => bail!("video previews use native playback or frame scrubbing"),
    };
    let final_path = frames.join(format!("{:016x}.{extension}", hash_key(&[&key])));
    let publication_lock = cache::lock(root);
    {
        let _guard = publication_lock.lock_unpoisoned();
        cache::reclaim(root, Some(&final_path), limits.cache_bytes)?;
        if is_non_empty_regular_file(&final_path) {
            if file_fingerprint(source) != (size, modified) {
                bail!("preview source changed while selecting cached media; reopen the preview");
            }
            return Ok(final_path);
        }
    }
    let temporary = cache::TemporaryPreview::new(&frames)?;
    let args = conversion_args(source, kind, &temporary.path(), limits.output_bytes)?;
    let output = run_preview_command(Command::new(ffmpeg).args(args), limits.timeout)?;
    if !output.status.success() {
        bail!(
            "media preview conversion failed for {} ({}): {}",
            source.display(),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let length = temporary.as_file().metadata()?.len();
    let safety_margin = (limits.output_bytes / 4).min(64 * 1024);
    if length == 0 || length >= limits.output_bytes.saturating_sub(safety_margin) {
        bail!("media preview is empty or reaches the configured preview size limit");
    }
    if file_fingerprint(source) != (size, modified) {
        bail!("preview source changed while preparing compatible media; reopen the preview");
    }
    let _guard = publication_lock.lock_unpoisoned();
    let available = limits
        .cache_bytes
        .checked_sub(length)
        .context("media preview exceeds cache capacity")?;
    cache::reclaim(root, None, available)?;
    temporary.publish(&final_path)?;
    Ok(final_path)
}

pub(crate) fn prepare_media_preview(
    source_path: &str,
    kind: PreviewMediaKind,
    tools: &ExternalToolSettings,
) -> Result<PathBuf> {
    let source = readable_source(source_path)?;
    if kind == PreviewMediaKind::Video {
        bail!("video previews use native playback or frame scrubbing");
    }
    let (ffmpeg, _, _) = ensure_tool_available(ExternalToolKind::Ffmpeg, tools)?;
    prepare_in_cache(source, kind, Path::new(&ffmpeg), &cache_root()?)
}

#[cfg(test)]
mod tests;
