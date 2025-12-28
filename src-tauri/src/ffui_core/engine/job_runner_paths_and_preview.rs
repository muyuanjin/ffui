// ============================================================================
// Path building utilities
// ============================================================================

/// 根据输入路径与容器格式构建最终输出路径。
///
/// 规则：
/// - 当预设显式指定 `container.format` 时，扩展名遵循容器（如 mkv→`.mkv`）；
/// - 否则退回到输入扩展名（如 `.mp4` → `.compressed.mp4`）。
fn build_compressed_video_path(
    input: &Path,
    container_format: Option<&str>,
    extra_suffix: &str,
) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let input_ext = input.extension().and_then(|e| e.to_str());
    let ext = infer_output_extension(container_format, input_ext);
    parent.join(format!("{stem}.compressed{extra_suffix}.{ext}"))
}

pub(super) fn build_video_output_path(input: &Path, container_format: Option<&str>) -> PathBuf {
    build_compressed_video_path(input, container_format, "")
}

// Temporary output path for video transcodes. We keep an extension that matches
// the target container (when known) so工具与用户都能从文件名推断大致类型，同时仅在
// 扩展名前插入 `.tmp`。成功转码后再重命名到稳定输出路径，以保证“原子替换”。
#[allow(dead_code)]
pub(super) fn build_video_tmp_output_path(
    input: &Path,
    container_format: Option<&str>,
) -> PathBuf {
    build_compressed_video_path(input, container_format, ".tmp")
}

#[allow(dead_code)]
pub(super) fn build_video_resume_tmp_output_path(
    input: &Path,
    container_format: Option<&str>,
) -> PathBuf {
    build_compressed_video_path(input, container_format, ".resume.tmp")
}

/// Temporary output path for a specific job segment.
///
/// Unlike the legacy `*.compressed.tmp.*` path, this includes the stable job id
/// (and a monotonic segment index) so multiple pauses/resumes or duplicate
/// enqueues for the same input file cannot collide on disk.
pub(super) fn build_video_job_segment_tmp_output_path(
    input: &Path,
    container_format: Option<&str>,
    job_id: &str,
    segment_index: u64,
) -> PathBuf {
    build_compressed_video_path(
        input,
        container_format,
        &format!(".{job_id}.seg{segment_index}.tmp"),
    )
}

/// Temporary output segment path derived from a *final output path*.
///
/// This is used when outputs are routed to a different directory than the
/// input file (e.g. via output policy fixed directory). Keeping segments next
/// to the final output keeps renames atomic and avoids cross-filesystem moves.
pub(super) fn build_video_job_segment_tmp_output_path_for_output(
    output_path: &Path,
    job_id: &str,
    segment_index: u64,
) -> PathBuf {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = output_path.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.{job_id}.seg{segment_index}.tmp.{ext}"))
}

pub(super) fn build_concat_demuxer_list_contents(
    segments: &[PathBuf],
    segment_durations: Option<&[f64]>,
) -> Result<String> {
    use std::fmt::Write as _;

    if segments.is_empty() {
        return Err(anyhow::anyhow!(
            "build_concat_demuxer_list_contents requires at least one segment path"
        ));
    }

    let durations = segment_durations.unwrap_or(&[]);
    let mut out = String::new();
    for (idx, seg) in segments.iter().enumerate() {
        let s = seg.to_string_lossy();
        // concat demuxer 使用单引号包裹路径，这里仅对单引号做转义。
        let escaped = s.replace('\'', "'\\''");
        drop(writeln!(&mut out, "file '{escaped}'").map_err(anyhow::Error::new));
        if let Some(d) = durations.get(idx).copied().filter(|v| v.is_finite() && *v > 0.0) {
            drop(
                writeln!(&mut out, "duration {d:.6}").map_err(anyhow::Error::new),
            );
            drop(
                writeln!(&mut out, "outpoint {d:.6}").map_err(anyhow::Error::new),
            );
        }
    }
    Ok(out)
}

pub(super) fn concat_video_segments(
    ffmpeg_path: &str,
    segments: &[PathBuf],
    segment_durations: Option<&[f64]>,
    target: &Path,
) -> Result<()> {
    if segments.is_empty() {
        return Err(anyhow::anyhow!(
            "concat_video_segments requires at least one segment path"
        ));
    }

    if segments.len() == 1 {
        // 单段场景退化为简单拷贝，避免不必要的 ffmpeg 调用。
        fs::copy(&segments[0], target).with_context(|| {
            format!(
                "failed to copy single segment {} -> {}",
                segments[0].display(),
                target.display()
            )
        })?;
        return Ok(());
    }

    // 使用 concat demuxer 进行无损拼接，避免 filter_complex 与 -c copy 组合
    // 带来的“不允许过滤+流复制”的问题，同时对多段输入更友好。
    //
    // 对于暂停/继续场景，如果我们知道每个分段的“期望时长”（由 join target 推导），
    // 则通过 list 中的 `duration ...` 指令强制 concat 的时间轴偏移，避免依赖容器
    // duration 推导而出现 1–2 帧级抖动。
    let list_path = target.with_extension("concat.list");
    {
        use std::io::Write as IoWrite;

        let mut file = std::fs::File::create(&list_path).with_context(|| {
            let joined = segments
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "failed to create concat list file {} for segments: {joined}",
                list_path.display()
            )
        })?;

        let content = build_concat_demuxer_list_contents(segments, segment_durations)?;
        file.write_all(content.as_bytes())
            .with_context(|| format!("failed to write concat list file {}", list_path.display()))?;
    }

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("-y")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(list_path.as_os_str())
        .arg("-c")
        .arg("copy")
        .arg(target.as_os_str())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .with_context(|| {
            let joined = segments
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!("failed to run ffmpeg concat for segments: {joined}")
        })?;

    drop(fs::remove_file(&list_path));

    if !status.success() {
        let joined = segments
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(anyhow::anyhow!(
            "ffmpeg concat failed with status {status} for segments: {joined}"
        ));
    }

    Ok(())
}

pub(super) fn remux_segment_drop_audio(ffmpeg_path: &str, segment: &Path) -> Result<()> {
    if !segment.exists() {
        return Ok(());
    }

    let marker = noaudio_marker_path_for_segment(segment);
    if marker.exists() {
        return Ok(());
    }

    let ext = segment
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    let tmp = segment.with_extension(format!("noaudio.tmp.{ext}"));

    let mut cmd = Command::new(ffmpeg_path);
    configure_background_command(&mut cmd);
    let status = cmd
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(segment.as_os_str())
        .arg("-map")
        .arg("0:v:0")
        .arg("-map")
        .arg("0:s?")
        .arg("-c")
        .arg("copy")
        .arg(tmp.as_os_str())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .with_context(|| format!("failed to run ffmpeg remux to drop audio for {}", segment.display()))?;

    if !status.success() {
        return Err(anyhow::anyhow!(
            "ffmpeg remux (drop audio) failed with status {status} for {}",
            segment.display()
        ));
    }

    // Best-effort replace on Windows: rename does not overwrite.
    drop(fs::remove_file(segment));
    fs::rename(&tmp, segment).with_context(|| {
        format!(
            "failed to replace remuxed segment {} -> {}",
            tmp.display(),
            segment.display()
        )
    })?;

    drop(fs::write(&marker, b""));
    Ok(())
}

/// Mark a segment as "audio already removed" without doing any remux work.
///
/// This is used as a cheap optimization when the current ffmpeg run is known
/// to have produced a video-only segment (e.g. resume flow with `-map -0:a`).
pub(super) fn mark_segment_noaudio_done(segment: &Path) {
    if !segment.exists() {
        return;
    }
    let marker = noaudio_marker_path_for_segment(segment);
    if marker.exists() {
        return;
    }
    drop(fs::write(&marker, b""));
}

pub(super) fn noaudio_marker_path_for_segment(segment: &Path) -> PathBuf {
    segment.with_extension("noaudio.done")
}
