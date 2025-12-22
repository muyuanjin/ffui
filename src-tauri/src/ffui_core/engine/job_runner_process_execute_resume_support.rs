fn log_resume_plan_and_normalize_segments(
    inner: &Inner,
    job_id: &str,
    ffmpeg_path: &str,
    resume_plan: Option<&ResumePlan>,
    finalize_with_source_audio: bool,
    existing_segments: &[PathBuf],
) {
    if let Some(plan) = resume_plan {
        let strategy = match plan.strategy {
            ResumeStrategy::LegacySeek => "legacy_seek",
            ResumeStrategy::OverlapTrim => "overlap_trim",
        };
        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "resume plan: strategy={strategy} target={:.6}s seek={:.6}s trimAt={:.6}s trimRel={:.6}s backtrack={:.3}s",
                    plan.target_seconds,
                    plan.seek_seconds,
                    plan.trim_at_seconds,
                    plan.trim_start_seconds,
                    plan.backtrack_seconds
                ),
            );
            if finalize_with_source_audio {
                super::worker_utils::append_job_log_line(
                    job,
                    "resume: final output will mux audio from source input (segments are video-only)".to_string(),
                );
            }
        }
    }

    if finalize_with_source_audio && !existing_segments.is_empty() {
        for seg in existing_segments {
            if let Err(err) = remux_segment_drop_audio(ffmpeg_path, seg.as_path()) {
                let mut state = inner.state.lock().expect("engine state poisoned");
                if let Some(job) = state.jobs.get_mut(job_id) {
                    super::worker_utils::append_job_log_line(
                        job,
                        format!(
                            "resume: warning: failed to remux prior segment to drop audio ({}): {err:#}",
                            seg.display()
                        ),
                    );
                }
            }
        }
    }
}

fn maybe_insert_copyts_for_overlap_trim(args: &mut Vec<String>, resume_plan: Option<ResumePlan>) {
    // For overlap+trim resume, keep source timestamps so the trim filter can
    // cut at an absolute target time that is stable across `-ss` seek jitter.
    if let Some(plan) = resume_plan
        && matches!(plan.strategy, ResumeStrategy::OverlapTrim)
    {
        let insert_at = args
            .iter()
            .position(|a| a == "-ss")
            .or_else(|| args.iter().position(|a| a == "-i"))
            .unwrap_or(0);
        if !args.iter().any(|a| a == "-copyts") {
            args.insert(insert_at, "-copyts".to_string());
        }
    }
}

fn derive_resume_concat_segment_durations(
    segment_end_targets: &[f64],
    all_segments_len: usize,
) -> Option<Vec<f64>> {
    // `segment_end_targets` contains the join target time after each completed
    // segment in `existing_segments` (i.e. all but the final segment).
    if all_segments_len < 2 || segment_end_targets.len() + 1 != all_segments_len {
        return None;
    }

    let mut prev = 0.0;
    let mut durations: Vec<f64> = Vec::with_capacity(segment_end_targets.len());
    for end in segment_end_targets {
        if !end.is_finite() || *end <= prev {
            return None;
        }
        durations.push(end - prev);
        prev = *end;
    }
    Some(durations)
}

fn maybe_inject_stats_period_for_download(
    cmd: &mut Command,
    args: &mut Vec<String>,
    settings_snapshot: &AppSettings,
    ffmpeg_source: &str,
) {
    // Increase structured progress update frequency for the bundled ffmpeg
    // binary so `job.progress` has a higher reporting rate without inventing
    // synthetic percentages. Old custom ffmpeg builds may not support this
    // flag, so we only apply it for the known static download source.
    if ffmpeg_source != "download" {
        return;
    }

    let interval_ms = settings_snapshot
        .progress_update_interval_ms
        .unwrap_or(DEFAULT_PROGRESS_UPDATE_INTERVAL_MS);
    // Clamp into a sensible range [50ms, 2000ms] to avoid extreme values.
    let clamped_ms = interval_ms.clamp(50, 2000) as f64;
    let stats_period_secs = clamped_ms / 1000.0;
    let stats_arg = format!("{stats_period_secs:.3}");
    cmd.arg("-stats_period").arg(&stats_arg);
    // 确保日志中记录的命令与实际执行的命令完全一致：包括 -stats_period 参数。
    args.insert(0, stats_arg);
    args.insert(0, "-stats_period".to_string());
}

fn send_ffmpeg_quit(stdin: &mut Option<std::process::ChildStdin>) {
    if let Some(mut stdin) = stdin.take() {
        use std::io::Write as IoWrite;
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
}

#[derive(Default)]
struct PauseLatencyDebug {
    wait_seen_ms: Option<u64>,
    q_sent_ms: Option<u64>,
    child_exit_ms: Option<u64>,
    mark_waiting_start_ms: Option<u64>,
    mark_waiting_end_ms: Option<u64>,
}

impl PauseLatencyDebug {
    fn mark_wait_seen(&mut self, now_ms: u64) {
        if self.wait_seen_ms.is_none() {
            self.wait_seen_ms = Some(now_ms);
        }
    }

    fn mark_q_sent(&mut self, now_ms: u64) {
        if self.q_sent_ms.is_none() {
            self.q_sent_ms = Some(now_ms);
        }
    }

    fn mark_child_exit(&mut self, now_ms: u64) {
        if self.child_exit_ms.is_none() {
            self.child_exit_ms = Some(now_ms);
        }
    }

    fn mark_mark_waiting_start(&mut self, now_ms: u64) {
        if self.mark_waiting_start_ms.is_none() {
            self.mark_waiting_start_ms = Some(now_ms);
        }
    }

    fn mark_mark_waiting_end(&mut self, now_ms: u64) {
        if self.mark_waiting_end_ms.is_none() {
            self.mark_waiting_end_ms = Some(now_ms);
        }
    }

    #[cfg(debug_assertions)]
    fn emit_pause_summary(&self, inner: &Inner, job_id: &str) {
        let Some(wait_seen_ms) = self.wait_seen_ms else {
            return;
        };
        let q_sent_ms = self.q_sent_ms.unwrap_or(wait_seen_ms);
        let child_exit_ms = self.child_exit_ms.unwrap_or(q_sent_ms);
        let mark_waiting_start_ms = self.mark_waiting_start_ms.unwrap_or(child_exit_ms);
        let mark_waiting_end_ms = self.mark_waiting_end_ms.unwrap_or(mark_waiting_start_ms);

        let wait_to_q = q_sent_ms.saturating_sub(wait_seen_ms);
        let q_to_exit = child_exit_ms.saturating_sub(q_sent_ms);
        let wait_to_exit = child_exit_ms.saturating_sub(wait_seen_ms);
        let exit_to_mark = mark_waiting_start_ms.saturating_sub(child_exit_ms);
        let mark_cost = mark_waiting_end_ms.saturating_sub(mark_waiting_start_ms);

        let mut state = inner.state.lock().expect("engine state poisoned");
        if let Some(job) = state.jobs.get_mut(job_id) {
            super::worker_utils::append_job_log_line(
                job,
                format!(
                    "debug: pause latency ms: wait→q={wait_to_q}, q→exit={q_to_exit}, wait→exit={wait_to_exit}, exit→mark={exit_to_mark}, mark={mark_cost}",
                ),
            );
        }
    }

    #[cfg(not(debug_assertions))]
    fn emit_pause_summary(&self, _inner: &Inner, _job_id: &str) {}
}

struct FfmpegStderrPump {
    rx: Option<std::sync::mpsc::Receiver<String>>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl FfmpegStderrPump {
    fn spawn(child: &mut std::process::Child) -> Self {
        let Some(stderr) = child.stderr.take() else {
            return Self { rx: None, join: None };
        };

        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let join = std::thread::spawn(move || {
            use std::io::BufRead as _;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if tx.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        Self {
            rx: Some(rx),
            join: Some(join),
        }
    }

    fn recv_timeout(&mut self, timeout: std::time::Duration) -> Option<String> {
        let Some(rx) = self.rx.as_ref() else {
            std::thread::sleep(timeout);
            return None;
        };

        match rx.recv_timeout(timeout) {
            Ok(line) => Some(line),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => None,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                self.rx = None;
                None
            }
        }
    }

    fn drain_available(&mut self, mut on_line: impl FnMut(String)) {
        let Some(rx) = self.rx.as_ref() else {
            return;
        };

        loop {
            match rx.try_recv() {
                Ok(line) => on_line(line),
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    self.rx = None;
                    break;
                }
            }
        }
    }

    fn join(&mut self) {
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}
