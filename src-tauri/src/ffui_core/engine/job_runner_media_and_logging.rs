// ============================================================================
// Media inspection
// ============================================================================

pub(super) fn inspect_media(inner: &Inner, path: String) -> Result<String> {
    let settings_snapshot = {
        let state = inner.state.lock().expect("engine state poisoned");
        state.settings.clone()
    };

    let (ffprobe_path, _source, did_download) =
        ensure_tool_available(ExternalToolKind::Ffprobe, &settings_snapshot.tools)?;

    if did_download {
        record_tool_download_with_inner(inner, ExternalToolKind::Ffprobe, &ffprobe_path);
    }

    let mut cmd = Command::new(&ffprobe_path);
    configure_background_command(&mut cmd);
    let output = cmd
        .arg("-v")
        .arg("quiet")
        .arg("-print_format")
        .arg("json")
        // Expose as much structured information as ffprobe provides so the
        // frontend can render rich media details (format, streams, chapters,
        // programs, tags, etc.).
        .arg("-show_format")
        .arg("-show_streams")
        .arg("-show_chapters")
        .arg("-show_programs")
        .arg(&path)
        .output()
        .with_context(|| format!("failed to run ffprobe on {path}"))?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Preserve the original ffprobe JSON shape (`format`, `streams`, etc.)
    // but enrich it with filesystem metadata under a stable `file` object
    // so the frontend can display creation/modification times and size.
    let raw = String::from_utf8_lossy(&output.stdout).into_owned();

    let mut root: serde_json::Value = serde_json::from_str(&raw)
        .with_context(|| "ffprobe JSON output should be valid UTF-8 JSON when status is success")?;

    // Best-effort filesystem metadata; failures are tolerated and simply
    // result in missing optional fields.
    let file_info = {
        use std::path::Path;

        let path_ref = Path::new(&path);
        let metadata = fs::metadata(path_ref).ok();

        // Use a by-reference pattern match so we can still inspect the
        // Option later when building the JSON object.
        let (size_bytes, created_ms, modified_ms, accessed_ms) = if let Some(ref m) = metadata {
            let size = Some(m.len());

            let created = m
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);
            let modified = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);
            let accessed = m
                .accessed()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);

            (size, created, modified, accessed)
        } else {
            (None, None, None, None)
        };

        serde_json::json!({
            "path": path,
            "exists": metadata.is_some(),
            "isFile": metadata.as_ref().map(|m| m.is_file()).unwrap_or(false),
            "isDir": metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            "sizeBytes": size_bytes,
            "createdMs": created_ms,
            "modifiedMs": modified_ms,
            "accessedMs": accessed_ms,
        })
    };

    if let serde_json::Value::Object(map) = &mut root {
        map.insert("file".to_string(), file_info);
    }

    Ok(root.to_string())
}

// ============================================================================
// Command logging
// ============================================================================

// Append the full external command line to the job logs so that the queue UI
// can always show users exactly what was executed, even if the tool exits
// before emitting any progress or error output.
pub(super) fn log_external_command(inner: &Inner, job_id: &str, program: &str, args: &[String]) {
    let mut state = inner.state.lock().expect("engine state poisoned");
    if let Some(job) = state.jobs.get_mut(job_id) {
        let now_ms = super::worker_utils::current_time_millis();
        let cmd = format_command_for_log(program, args);

        // Ensure the first/full command stays stable: only set ffmpeg_command
        // when it is still unset (enqueue normally pre-populates it).
        if job.ffmpeg_command.is_none() {
            job.ffmpeg_command = Some(cmd.clone());
        }

        // Each ffmpeg launch (initial run, resume, retry) becomes a distinct run.
        // If enqueue created a placeholder Run 1 (started_at_ms == None), we
        // attach this first launch to that run instead of creating Run 2.
        if job.runs.is_empty() {
            let initial = job.ffmpeg_command.clone().unwrap_or_else(|| cmd.clone());
            job.runs.push(crate::ffui_core::domain::JobRun {
                command: initial,
                logs: Vec::new(),
                started_at_ms: Some(now_ms),
            });
        } else if let Some(last) = job.runs.last_mut()
            && last.started_at_ms.is_none()
            && job.progress <= 0.0
            && job.wait_metadata.is_none()
        {
            last.started_at_ms = Some(now_ms);
            if last.command.is_empty() {
                last.command = job.ffmpeg_command.clone().unwrap_or_else(|| cmd.clone());
            }
        } else {
            job.runs.push(crate::ffui_core::domain::JobRun {
                command: cmd.clone(),
                logs: Vec::new(),
                started_at_ms: Some(now_ms),
            });
        }

        let command_line = format!("command: {cmd}");
        super::worker_utils::append_job_log_line(job, command_line);

        // If the advanced ffmpeg template or args force a very restrictive log
        // level (for example `-v error` or `-loglevel quiet`), ffmpeg will not
        // emit the usual `time=...` progress lines. In that configuration the
        // backend cannot compute real percentages and the UI will only ever
        // show 0% followed by a sudden jump to 100% on completion. Surface a
        // warning in the job logs so users understand that this is expected
        // behavior and not a progress tracking bug.
        if args.iter().any(|a| {
            a.eq_ignore_ascii_case("-loglevel")
                || a.eq_ignore_ascii_case("-v")
                || a.eq_ignore_ascii_case("quiet")
                || a.eq_ignore_ascii_case("error")
                || a.eq_ignore_ascii_case("fatal")
                || a.eq_ignore_ascii_case("panic")
        }) {
            let warning =
                "warning: detected restricted loglevel; progress may remain at 0% until completion"
                    .to_string();
            super::worker_utils::append_job_log_line(job, warning);
        }
    }
}
