use std::collections::BTreeMap;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use super::super::state_persist::{load_persisted_queue_state, load_persisted_terminal_job_logs};
use super::super::worker_utils::{append_job_log_line, recompute_log_tail};
use super::Inner;
use crate::ffui_core::domain::{JobStatus, JobType, QueueState, TranscodeJob, WaitMetadata};
use crate::ffui_core::engine::segment_discovery;
use crate::ffui_core::settings::types::QueuePersistenceMode;
use crate::sync_ext::MutexExt;

pub(in crate::ffui_core::engine) fn restore_jobs_from_persisted_queue(inner: &Inner) {
    // Respect the configured queue persistence mode; when disabled we skip
    // loading any previous queue snapshot and start from a clean state.
    {
        let state = inner.state.lock_unpoisoned();
        if !matches!(
            state.settings.queue_persistence_mode,
            QueuePersistenceMode::CrashRecoveryLite | QueuePersistenceMode::CrashRecoveryFull
        ) {
            return;
        }
    }

    let (mode, retention) = {
        let state = inner.state.lock_unpoisoned();
        (
            state.settings.queue_persistence_mode,
            state.settings.crash_recovery_log_retention,
        )
    };

    let snapshot = match load_persisted_queue_state() {
        Some(s) => s,
        None => return,
    };

    // In full crash recovery mode, load per-job logs from disk before inserting
    // restored jobs into the engine state so get_job_detail remains in-memory.
    let terminal_job_ids: Vec<String> = snapshot
        .jobs
        .iter()
        .filter(|j| {
            matches!(
                j.status,
                JobStatus::Completed
                    | JobStatus::Failed
                    | JobStatus::Skipped
                    | JobStatus::Cancelled
            )
        })
        .map(|j| j.id.clone())
        .collect();

    let terminal_logs =
        if mode == QueuePersistenceMode::CrashRecoveryFull && !terminal_job_ids.is_empty() {
            load_persisted_terminal_job_logs(&terminal_job_ids, retention.unwrap_or_default())
        } else {
            Vec::new()
        };

    let mut snapshot = snapshot;
    if !terminal_logs.is_empty() {
        use std::collections::HashMap;
        let map: HashMap<String, Vec<crate::ffui_core::domain::JobRun>> =
            terminal_logs.into_iter().collect();
        for job in snapshot.jobs.iter_mut() {
            if let Some(runs) = map.get(&job.id) {
                job.runs = runs.clone();
                job.logs = runs
                    .iter()
                    .flat_map(|r| r.logs.iter().cloned())
                    .collect::<Vec<_>>();
                if let Some(first) = job.runs.first_mut()
                    && first.command.trim().is_empty()
                    && let Some(cmd) = job.ffmpeg_command.clone()
                    && !cmd.trim().is_empty()
                {
                    first.command = cmd;
                }
                if job.ffmpeg_command.is_none()
                    && let Some(cmd) = job
                        .runs
                        .first()
                        .map(|r| r.command.trim().to_string())
                        .filter(|s| !s.is_empty())
                {
                    job.ffmpeg_command = Some(cmd);
                }
                job.log_head = None;
                recompute_log_tail(job);
            }
        }
    }
    restore_jobs_from_snapshot(inner, snapshot);
}

pub(super) fn restore_jobs_from_snapshot(inner: &Inner, snapshot: QueueState) {
    // Ensure that newly enqueued jobs after recovery do not reuse IDs from the
    // restored snapshot. Otherwise inserting into the HashMap<String, TranscodeJob>
    // would overwrite existing entries and appear to "replace" existing tasks.
    let mut max_numeric_id: u64 = 0;
    for job in &snapshot.jobs {
        if let Some(suffix) = job.id.strip_prefix("job-")
            && let Ok(n) = suffix.parse::<u64>()
            && n > max_numeric_id
        {
            max_numeric_id = n;
        }
    }
    if max_numeric_id > 0 {
        let current = inner.next_job_id.load(std::sync::atomic::Ordering::Relaxed);
        inner.next_job_id.store(
            current.max(max_numeric_id + 1),
            std::sync::atomic::Ordering::Relaxed,
        );
    }

    let mut waiting: Vec<(u64, String)> = Vec::new();
    let mut segment_probes: Vec<SegmentProbe> = Vec::new();

    {
        let mut state = inner.state.lock_unpoisoned();

        for mut job in snapshot.jobs {
            job.ensure_run_history_from_legacy();
            let id = job.id.clone();

            // If a job with the same id was already enqueued in this run,
            // keep the in-memory version and skip the persisted one.
            if state.jobs.contains_key(&id) {
                continue;
            }

            // Jobs that were previously in Processing are treated as Paused so
            // they do not auto-resume on startup but remain recoverable.
            if job.status == JobStatus::Processing {
                job.status = JobStatus::Paused;
                append_job_log_line(
                    &mut job,
                    "Recovered after unexpected shutdown; job did not finish in previous run."
                        .to_string(),
                );
                job.log_head = None;
            }

            let persisted_order = job.queue_order;
            job.queue_order = None;

            // Best-effort crash recovery metadata for video jobs that had
            // already made some progress. When a temp output exists but no
            // WaitMetadata was recorded (for example due to a power loss),
            // attach the path so a later resume can attempt concat-based
            // continuation instead of always restarting from 0%.
            // 处理耗时基线属于运行期信息，恢复时清空，待重新进入 Processing 时再设置。
            job.processing_started_ms = None;
            if matches!(job.job_type, JobType::Video)
                && matches!(
                    job.status,
                    JobStatus::Waiting | JobStatus::Queued | JobStatus::Paused
                )
                && should_probe_segments_for_crash_recovery(&job)
            {
                segment_probes.push(SegmentProbe {
                    id: id.clone(),
                    input_path: PathBuf::from(job.filename.trim()),
                    output_path: job.output_path.as_deref().map(|s| PathBuf::from(s.trim())),
                    progress: job.progress,
                    elapsed_ms: job.elapsed_ms,
                    existing_wait_metadata: job.wait_metadata.clone(),
                });
            }

            if matches!(job.status, JobStatus::Waiting | JobStatus::Queued) {
                let order = persisted_order.unwrap_or(u64::MAX);
                waiting.push((order, id.clone()));
            }

            state.jobs.insert(id, job);
        }

        waiting.sort_by(|(ao, aid), (bo, bid)| ao.cmp(bo).then(aid.cmp(bid)));

        let recovered_ids: Vec<String> = waiting.drain(..).map(|(_, id)| id).collect();
        let recovered_set: HashSet<String> = recovered_ids.iter().cloned().collect();
        let existing_ids: Vec<String> = state.queue.iter().cloned().collect();

        let mut seen: HashSet<String> =
            HashSet::with_capacity(recovered_set.len().saturating_add(existing_ids.len()));
        let mut next_queue: VecDeque<String> = VecDeque::new();
        for id in recovered_ids {
            if seen.insert(id.clone()) {
                next_queue.push_back(id);
            }
        }
        for id in existing_ids {
            if !recovered_set.contains(&id) && seen.insert(id.clone()) {
                next_queue.push_back(id);
            }
        }

        state.queue = next_queue;
    }

    // Perform any filesystem probes (e.g. temp output existence checks)
    // outside the engine lock to avoid blocking concurrent queue snapshots.
    if !segment_probes.is_empty() {
        let mut recovered: Vec<(String, WaitMetadata)> = Vec::new();

        for probe in segment_probes {
            let meta = recover_wait_metadata_from_filesystem(&probe);
            if let Some(meta) = meta {
                recovered.push((probe.id, meta));
            }
        }

        if !recovered.is_empty() {
            let mut state = inner.state.lock_unpoisoned();
            for (id, meta) in recovered {
                let Some(job) = state.jobs.get_mut(&id) else {
                    continue;
                };
                // Only apply if we actually improve crash-recovery ability:
                // - missing wait metadata
                // - or existing metadata has no usable segment paths.
                let should_apply = job
                    .wait_metadata
                    .as_ref()
                    .map(wait_metadata_has_no_usable_paths)
                    .unwrap_or(true);
                if should_apply {
                    job.wait_metadata = Some(meta);
                }
            }
        }
    }

    // Emit a snapshot so the frontend sees the recovered queue without having
    // to poll immediately after startup.
    super::notify_queue_listeners(inner);

    // Wake any worker threads that might already be waiting for work so they
    // can immediately observe the recovered queue instead of staying parked
    // on the condition variable until a brand-new job is enqueued.
    inner.cv.notify_all();
}

#[derive(Debug, Clone)]
struct SegmentProbe {
    id: String,
    input_path: PathBuf,
    output_path: Option<PathBuf>,
    progress: f64,
    elapsed_ms: Option<u64>,
    existing_wait_metadata: Option<WaitMetadata>,
}

fn should_probe_segments_for_crash_recovery(job: &TranscodeJob) -> bool {
    // We probe when crash recovery might have missed `wait_metadata` due to
    // debounce/force-kill timing, or when metadata exists but contains no
    // usable segment paths (e.g. output policy changed across refactors).
    match job.wait_metadata.as_ref() {
        None => true,
        Some(meta) => {
            let has_any_paths = meta
                .segments
                .as_ref()
                .map(|v| v.iter().any(|s| !s.trim().is_empty()))
                .unwrap_or(false)
                || meta
                    .tmp_output_path
                    .as_ref()
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
            !has_any_paths
        }
    }
}

fn wait_metadata_has_no_usable_paths(meta: &WaitMetadata) -> bool {
    if let Some(segs) = meta.segments.as_ref()
        && segs.iter().any(|s| {
            let trimmed = s.trim();
            !trimmed.is_empty() && Path::new(trimmed).exists()
        })
    {
        return false;
    }
    if let Some(tmp) = meta.tmp_output_path.as_ref() {
        let trimmed = tmp.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return false;
        }
    }
    true
}

fn recover_wait_metadata_from_filesystem(probe: &SegmentProbe) -> Option<WaitMetadata> {
    let mut found: BTreeMap<u64, PathBuf> = BTreeMap::new();

    // 1) Prefer output-path-derived segments (supports fixed output directories
    // and the post-refactor "{stem}.{jobId}.segN.tmp.{ext}" naming).
    if let Some(output_path) = probe.output_path.as_ref() {
        segment_discovery::discover_segments_for_output_path(output_path, &probe.id, &mut found);
    }

    // 2) Also scan for per-job ".compressed.{jobId}.segN.tmp.*" segments placed
    // next to the input (legacy, or same-as-input output policy).
    segment_discovery::discover_segments_for_input_path(&probe.input_path, &probe.id, &mut found);

    // 3) Fall back to a single legacy temp output file when segment naming is unknown.
    if found.is_empty()
        && let Some(legacy_tmp) =
            segment_discovery::build_legacy_video_tmp_output_path(&probe.input_path)
        && legacy_tmp.exists()
    {
        found.insert(0, legacy_tmp);
    }

    // 4) Merge in any existing wait metadata paths that still exist on disk.
    if let Some(existing) = probe.existing_wait_metadata.as_ref() {
        for (idx, path) in wait_metadata_existing_paths(existing)
            .into_iter()
            .enumerate()
        {
            if path.exists() {
                // Use a stable, monotonic key when we cannot parse the true segment index.
                let key = u64::try_from(10_000_000usize.saturating_add(idx)).unwrap_or(u64::MAX);
                found.entry(key).or_insert(path);
            }
        }
    }

    let mut segments: Vec<String> = Vec::new();
    for (_idx, path) in found {
        segments.push(path.to_string_lossy().into_owned());
    }
    if segments.is_empty() {
        return None;
    }

    let last = segments.last().cloned();
    let mut meta = probe
        .existing_wait_metadata
        .clone()
        .unwrap_or(WaitMetadata {
            last_progress_percent: Some(probe.progress),
            processed_wall_millis: probe.elapsed_ms,
            processed_seconds: None,
            target_seconds: None,
            tmp_output_path: None,
            segments: None,
            segment_end_targets: None,
        });
    meta.last_progress_percent = meta.last_progress_percent.or(Some(probe.progress));
    meta.processed_wall_millis = meta.processed_wall_millis.or(probe.elapsed_ms);
    meta.segments = Some(segments);
    meta.tmp_output_path = last;

    // If we reconstructed/merged segment paths, any per-segment join targets
    // are no longer guaranteed to align. Let the resume pipeline probe or
    // rebuild targets conservatively.
    meta.segment_end_targets = None;

    Some(meta)
}

fn wait_metadata_existing_paths(meta: &WaitMetadata) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(segs) = meta.segments.as_ref() {
        for s in segs {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                continue;
            }
            out.push(PathBuf::from(trimmed));
        }
    }
    if out.is_empty()
        && let Some(tmp) = meta.tmp_output_path.as_ref()
    {
        let trimmed = tmp.trim();
        if !trimmed.is_empty() {
            out.push(PathBuf::from(trimmed));
        }
    }
    out
}

// Legacy ".compressed.tmp.{ext}" file is handled by the filesystem recovery probe.
