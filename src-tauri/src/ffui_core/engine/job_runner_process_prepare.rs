fn plan_resume_paths(
    input_path: &Path,
    media_duration: Option<f64>,
    wait_meta: Option<&WaitMetadata>,
    container_format: Option<&str>,
) -> (Option<f64>, Vec<PathBuf>, PathBuf) {
    let base_tmp_output = build_video_tmp_output_path(input_path, container_format);
    let resume_tmp_output = build_video_resume_tmp_output_path(input_path, container_format);

    // 根据 WaitMetadata 计算“已处理秒数”和历史分段列表，以支撑多次暂停/继续。
    let mut resume_from_seconds: Option<f64> = None;
    let mut existing_segments: Vec<PathBuf> = Vec::new();

    if let Some(meta) = wait_meta {
        // 1) 计算当前已经处理到的时间位置，用于构建下一轮的 -ss。
        if let Some(processed) = meta.processed_seconds {
            if processed.is_finite() && processed > 0.0 {
                resume_from_seconds = Some(processed);
            }
        } else if let (Some(pct), Some(total)) = (meta.last_progress_percent, media_duration)
            && pct.is_finite()
            && pct > 0.0
            && total.is_finite()
            && total > 0.0
        {
            let processed = (pct / 100.0) * total;
            if processed > 0.0 {
                resume_from_seconds = Some(processed);
            }
        }

        // 2) 构建历史分段列表：优先使用 segments，回退到单一 tmp_output_path。
        if let Some(ref segs) = meta.segments {
            for s in segs {
                let path = PathBuf::from(s);
                if path.exists() {
                    existing_segments.push(path);
                }
            }
        }

        if existing_segments.is_empty()
            && let Some(tmp) = meta.tmp_output_path.as_ref()
        {
            let path = PathBuf::from(tmp);
            if path.exists() {
                existing_segments.push(path);
            }
        }
    }

    // 无有效历史分段或缺乏位置信息时，回退为从 0% 开始的新一次转码。
    if existing_segments.is_empty() || resume_from_seconds.is_none() {
        return (None, Vec::new(), base_tmp_output);
    }

    let tmp_output = resume_tmp_output;

    (resume_from_seconds, existing_segments, tmp_output)
}

/// 为 mp4/mov 输出启用 fragmented MP4 相关 movflags，提升在崩溃或异常中断时
/// 临时分段文件的可读性与可 concat 性。
///
/// 这里不会移除用户已经配置的 movflags，只会在缺失时追加
/// `frag_keyframe` 与 `empty_moov` 两个标志。
fn ensure_fragmented_movflags_for_mp4_like_output(
    preset: &mut crate::ffui_core::domain::FFmpegPreset,
    output_path: &Path,
) {
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // 只针对 mp4/mov 系列容器启用 fragmented movflags。
    if ext != "mp4" && ext != "mov" && ext != "m4v" {
        return;
    }

    use crate::ffui_core::domain::ContainerConfig;

    let container = preset
        .container
        .get_or_insert(ContainerConfig {
            format: None,
            movflags: None,
        });

    let mut flags = container.movflags.clone().unwrap_or_default();
    let mut ensure_flag = |flag: &str| {
        if !flags.iter().any(|f| f == flag) {
            flags.push(flag.to_string());
        }
    };

    ensure_flag("frag_keyframe");
    ensure_flag("empty_moov");

    container.movflags = Some(flags);
}

fn prepare_transcode_job(inner: &Inner, job_id: &str) -> Result<Option<PreparedTranscodeJob>> {
    let (
        input_path,
        preset,
        settings_snapshot,
        original_size_bytes,
        job_type,
        preset_id,
        cached_media_info,
        job_filename,
        job_wait_metadata,
    ) = {
        let state = inner.state.lock().expect("engine state poisoned");
        let job = match state.jobs.get(job_id) {
            Some(job) => job.clone(),
            None => return Ok(None),
        };

        let preset = state
            .presets
            .iter()
            .find(|p| p.id == job.preset_id)
            .cloned();
        let original_size_bytes = fs::metadata(&job.filename).map(|m| m.len()).unwrap_or(0);
        let cached_media_info = state.media_info_cache.get(&job.filename).cloned();

        (
            PathBuf::from(&job.filename),
            preset,
            state.settings.clone(),
            original_size_bytes,
            job.job_type.clone(),
            job.preset_id.clone(),
            cached_media_info,
            job.filename.clone(),
            job.wait_metadata.clone(),
        )
    };

    if job_type != JobType::Video {
        // For now, only video jobs are processed by the background worker.
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.status = JobStatus::Skipped;
                job.progress = 100.0;
                job.end_time = Some(current_time_millis());
                job.skip_reason =
                    Some("Only video jobs are processed by the ffmpeg worker".to_string());
            }
        }
        mark_smart_scan_child_processed(inner, job_id);
        return Ok(None);
    }

    let preset = match preset {
        Some(p) => p,
        None => {
            {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    job.status = JobStatus::Failed;
                    job.progress = 100.0;
                    job.end_time = Some(current_time_millis());
                    let reason = format!("No preset found for preset id '{preset_id}'");
                    job.failure_reason = Some(reason.clone());
                    job.logs.push(reason);
                    recompute_log_tail(job);
                }
            }
            mark_smart_scan_child_processed(inner, job_id);
            return Ok(None);
        }
    };

    // Ensure ffmpeg is available, honoring auto-download / update settings.
    // `ffmpeg_source` is used to decide whether it is safe to enable newer
    // CLI flags such as `-stats_period` which are guaranteed to exist on the
    // auto-downloaded static builds we ship, but may not be present on very
    // old custom ffmpeg binaries provided by the user.
    let (ffmpeg_path, ffmpeg_source, did_download) =
        ensure_tool_available(ExternalToolKind::Ffmpeg, &settings_snapshot.tools)?;

    if did_download {
        {
            let mut state = inner.state.lock().expect("engine state poisoned");
            if let Some(job) = state.jobs.get_mut(job_id) {
                job.logs.push(format!(
                    "auto-download: ffmpeg was downloaded automatically according to current settings (path: {ffmpeg_path})"
                ));
                recompute_log_tail(job);
            }
        }
        // Persist metadata for the newly downloaded ffmpeg binary.
        record_tool_download_with_inner(inner, ExternalToolKind::Ffmpeg, &ffmpeg_path);
    }

    // Build or reuse cached media metadata for the input so the UI can show
    // duration/codec/size without repeated ffprobe calls for the same file.
    let mut media_info = cached_media_info.unwrap_or(MediaInfo {
        duration_seconds: None,
        width: None,
        height: None,
        frame_rate: None,
        video_codec: None,
        audio_codec: None,
        size_mb: if original_size_bytes > 0 {
            Some(original_size_bytes as f64 / (1024.0 * 1024.0))
        } else {
            None
        },
    });

    if media_info.duration_seconds.is_none()
        && let Ok(d) = detect_duration_seconds(&input_path, &settings_snapshot)
    {
        media_info.duration_seconds = Some(d);
    }

    if media_info.video_codec.is_none()
        && let Ok(codec) = detect_video_codec(&input_path, &settings_snapshot)
    {
        media_info.video_codec = Some(codec);
    }

    if (media_info.width.is_none()
        || media_info.height.is_none()
        || media_info.frame_rate.is_none())
        && let Ok((width, height, frame_rate)) =
            detect_video_dimensions_and_frame_rate(&input_path, &settings_snapshot)
    {
        if media_info.width.is_none() {
            media_info.width = width;
        }
        if media_info.height.is_none() {
            media_info.height = height;
        }
        if media_info.frame_rate.is_none() {
            media_info.frame_rate = frame_rate;
        }
    }

    let output_path = {
        // Prefer a job-specific output path when provided (for example from
        // Smart Scan), falling back to the deterministic helper for older
        // manual jobs.
        let state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get(job_id) {
            if let Some(ref out) = job.output_path {
                PathBuf::from(out)
            } else {
                build_video_output_path(
                    &input_path,
                    preset
                        .container
                        .as_ref()
                        .and_then(|c| c.format.as_deref()),
                )
            }
        } else {
            build_video_output_path(
                &input_path,
                preset
                    .container
                    .as_ref()
                    .and_then(|c| c.format.as_deref()),
            )
        }
    };
    let (mut resume_from_seconds, mut existing_segments, tmp_output) = plan_resume_paths(
        &input_path,
        media_info.duration_seconds,
        job_wait_metadata.as_ref(),
        preset
            .container
            .as_ref()
            .and_then(|c| c.format.as_deref()),
    );
    // Prefer duration from ffprobe when available, but allow the ffmpeg
    // stderr metadata lines (e.g. "Duration: 00:01:29.95, ...") to fill this
    // in later if ffprobe is missing or fails on the current file.
    let total_duration = media_info.duration_seconds;
    let preview_path = generate_preview_for_video(
        &input_path,
        &ffmpeg_path,
        total_duration,
        settings_snapshot.preview_capture_percent,
    );

    {
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            job.input_path = Some(input_path.to_string_lossy().into_owned());
            job.output_path = Some(output_path.to_string_lossy().into_owned());
            job.media_info = Some(media_info.clone());
            if let Some(preview) = &preview_path {
                job.preview_path = Some(preview.to_string_lossy().into_owned());
            }
            if matches!(job.job_type, JobType::Video) {
                let tmp_str = tmp_output.to_string_lossy().into_owned();
                match job.wait_metadata.as_mut() {
                    Some(meta) => {
                        if meta.tmp_output_path.is_none() {
                            meta.tmp_output_path = Some(tmp_str.clone());
                        }
                    }
                    None => {
                        job.wait_metadata = Some(WaitMetadata {
                            last_progress_percent: None,
                            processed_wall_millis: None,
                            processed_seconds: None,
                            tmp_output_path: Some(tmp_str.clone()),
                            segments: Some(vec![tmp_str.clone()]),
                        });
                    }
                }
            }
            state
                .media_info_cache
                .insert(job_filename.clone(), media_info.clone());
        }
    }
    // Broadcast an updated queue snapshot with media metadata and preview path before starting the heavy ffmpeg transcode.
    notify_queue_listeners(inner);

    // For resumed jobs, derive an effective preset that seeks into the input
    // at the last known processed position using an input-side `-ss` so the
    // new segment continues where the previous temp output stopped. When the
    // preset already defines a custom output-side seek we fall back to a
    // fresh run to avoid surprising overrides.
    let mut effective_preset = preset.clone();
    if let Some(offset) = resume_from_seconds {
        let mut clone = preset.clone();
        match clone.input {
            Some(ref mut timeline) => {
                use crate::ffui_core::domain::SeekMode;
                match timeline.seek_mode {
                    None | Some(SeekMode::Input) => {
                        timeline.seek_mode = Some(SeekMode::Input);
                        timeline.seek_position = Some(format!("{offset:.3}"));
                        if timeline.accurate_seek.is_none() {
                            timeline.accurate_seek = Some(true);
                        }
                        effective_preset = clone;
                    }
                    Some(SeekMode::Output) => {
                        // Preserve caller-provided output-side seeking; disable
                        // automatic resume for such advanced timelines.
                        resume_from_seconds = None;
                        existing_segments.clear();
                        effective_preset = preset.clone();
                    }
                }
            }
            None => {
                use crate::ffui_core::domain::{InputTimelineConfig, SeekMode};
                let timeline = InputTimelineConfig {
                    seek_mode: Some(SeekMode::Input),
                    seek_position: Some(format!("{offset:.3}")),
                    duration_mode: None,
                    duration: None,
                    accurate_seek: Some(true),
                };
                clone.input = Some(timeline);
                effective_preset = clone;
            }
        }
    }

    // 为 mp4/mov 输出启用 fragmented MP4 片段写入，提高“暂停/崩溃后继续”场景下
    // 临时分段文件的稳健性。最终完整输出的 concat 会基于这些分段进行无损拼接。
    ensure_fragmented_movflags_for_mp4_like_output(&mut effective_preset, &output_path);

    Ok(Some(PreparedTranscodeJob {
        input_path,
        settings_snapshot,
        preset: effective_preset,
        original_size_bytes,
        preset_id,
        output_path,
        resume_from_seconds,
        existing_segments,
        tmp_output,
        total_duration,
        ffmpeg_path: ffmpeg_path.clone(),
        ffmpeg_source: ffmpeg_source.clone(),
    }))
}

#[cfg(test)]
mod process_prepare_tests {
    use super::*;
    use std::env;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn plan_resume_paths_uses_first_tmp_segment_for_initial_resume() {
        let dir = env::temp_dir();
        let input = dir.join("ffui_resume_plan_first.mp4");
        let base_tmp = build_video_tmp_output_path(&input, None);
        let resume_tmp = build_video_resume_tmp_output_path(&input, None);

        // 构造一次“首次暂停”的场景：存在基础临时输出段，并在 WaitMetadata 中记录。
        if let Some(parent) = base_tmp.parent() {
            let _ = fs::create_dir_all(parent);
        }
        {
            let mut file =
                File::create(&base_tmp).expect("create base tmp segment for first resume test");
            let _ = file.write_all(b"segment");
        }

        let meta = WaitMetadata {
            last_progress_percent: None,
            processed_wall_millis: None,
            processed_seconds: Some(12.5),
            tmp_output_path: Some(base_tmp.to_string_lossy().into_owned()),
            segments: Some(vec![base_tmp.to_string_lossy().into_owned()]),
        };

        let (resume_from, existing, tmp_output) =
            plan_resume_paths(&input, Some(100.0), Some(&meta), None);

        assert!(
            (resume_from.unwrap_or(0.0) - 12.5).abs() < f64::EPSILON,
            "首次继续时应复用 WaitMetadata 中记录的 processed_seconds"
        );
        assert_eq!(
            existing,
            vec![base_tmp.clone()],
            "existing_segments 必须包含基础临时输出段"
        );
        assert_eq!(
            tmp_output, resume_tmp,
            "首次继续时应将新的输出写入 resume 临时路径"
        );

        let _ = fs::remove_file(&base_tmp);
        let _ = fs::remove_file(&resume_tmp);
    }

    #[test]
    fn plan_resume_paths_builds_existing_segments_from_metadata() {
        let dir = env::temp_dir();
        let input = dir.join("ffui_resume_plan_multi.mp4");
        let base_tmp = build_video_tmp_output_path(&input, None);
        let resume_tmp = build_video_resume_tmp_output_path(&input, None);

        // 构造“再次继续”场景：已经存在两段历史分段文件，WaitMetadata.segments 中记录其路径。
        if let Some(parent) = base_tmp.parent() {
            let _ = fs::create_dir_all(parent);
        }
        {
            let mut file = File::create(&base_tmp)
                .expect("create base tmp segment for multi-resume test");
            let _ = file.write_all(b"segment1");
        }
        {
            let mut file = File::create(&resume_tmp)
                .expect("create resume tmp segment for multi-resume test");
            let _ = file.write_all(b"segment2");
        }

        let meta = WaitMetadata {
            last_progress_percent: Some(50.0),
            processed_wall_millis: None,
            processed_seconds: Some(50.0),
            tmp_output_path: Some(resume_tmp.to_string_lossy().into_owned()),
            segments: Some(vec![
                base_tmp.to_string_lossy().into_owned(),
                resume_tmp.to_string_lossy().into_owned(),
            ]),
        };

        let (resume_from, existing, tmp_output) =
            plan_resume_paths(&input, Some(100.0), Some(&meta), None);

        assert!(
            (resume_from.unwrap_or(0.0) - 50.0).abs() < f64::EPSILON,
            "应从 WaitMetadata.processed_seconds 计算继续位置"
        );
        assert_eq!(
            existing,
            vec![base_tmp.clone(), resume_tmp.clone()],
            "existing_segments 必须按顺序包含所有历史分段"
        );
        assert_eq!(
            tmp_output,
            build_video_resume_tmp_output_path(&input, None),
            "存在历史分段时应将新输出写入 resume 临时路径"
        );

        let _ = fs::remove_file(&base_tmp);
        let _ = fs::remove_file(&resume_tmp);
    }
}
