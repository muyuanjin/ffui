use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};

use crate::ffui_core::domain::{JobStatus, JobType, QueueState, WaitMetadata};
use crate::ffui_core::settings::types::QueuePersistenceMode;

use super::super::state_persist::{load_persisted_queue_state, load_persisted_terminal_job_logs};
use super::super::worker_utils::recompute_log_tail;
use super::Inner;

pub(in crate::ffui_core::engine) fn restore_jobs_from_persisted_queue(inner: &Inner) {
    // Respect the configured queue persistence mode; when disabled we skip
    // loading any previous queue snapshot and start from a clean state.
    {
        let state = inner.state.lock().expect("engine state poisoned");
        if !matches!(
            state.settings.queue_persistence_mode,
            QueuePersistenceMode::CrashRecoveryLite | QueuePersistenceMode::CrashRecoveryFull
        ) {
            return;
        }
    }

    let (mode, retention) = {
        let state = inner.state.lock().expect("engine state poisoned");
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
        let map: HashMap<String, Vec<String>> = terminal_logs.into_iter().collect();
        for job in snapshot.jobs.iter_mut() {
            if let Some(lines) = map.get(&job.id) {
                job.logs = lines.clone();
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
        let current = inner.next_job_id.load(std::sync::atomic::Ordering::SeqCst);
        inner.next_job_id.store(
            current.max(max_numeric_id + 1),
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    let mut waiting: Vec<(u64, String)> = Vec::new();
    let mut tmp_output_candidates: Vec<(String, PathBuf, f64, Option<u64>)> = Vec::new();

    {
        let mut state = inner.state.lock().expect("engine state poisoned");

        for mut job in snapshot.jobs {
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
                job.logs.push(
                    "Recovered after unexpected shutdown; job did not finish in previous run."
                        .to_string(),
                );
                job.log_head = None;
                recompute_log_tail(&mut job);
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
                && job.wait_metadata.is_none()
            {
                let tmp_output = build_video_tmp_output_path(Path::new(&job.filename));
                tmp_output_candidates.push((id.clone(), tmp_output, job.progress, job.elapsed_ms));
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

        let mut next_queue: VecDeque<String> = VecDeque::new();
        for id in recovered_ids {
            if !next_queue.contains(&id) {
                next_queue.push_back(id);
            }
        }
        for id in existing_ids {
            if !recovered_set.contains(&id) && !next_queue.contains(&id) {
                next_queue.push_back(id);
            }
        }

        state.queue = next_queue;
    }

    // Perform any filesystem probes (e.g. temp output existence checks)
    // outside the engine lock to avoid blocking concurrent queue snapshots.
    if !tmp_output_candidates.is_empty() {
        let mut recovered_tmp_outputs: Vec<(String, String, f64, Option<u64>)> = Vec::new();
        for (id, tmp_output, progress, elapsed_ms) in tmp_output_candidates {
            if tmp_output.exists() {
                let tmp_str = tmp_output.to_string_lossy().into_owned();
                recovered_tmp_outputs.push((id, tmp_str, progress, elapsed_ms));
            }
        }

        if !recovered_tmp_outputs.is_empty() {
            let mut state = inner.state.lock().expect("engine state poisoned");
            for (id, tmp_str, progress, elapsed_ms) in recovered_tmp_outputs {
                if let Some(job) = state.jobs.get_mut(&id)
                    && job.wait_metadata.is_none()
                {
                    job.wait_metadata = Some(WaitMetadata {
                        last_progress_percent: Some(progress),
                        processed_wall_millis: elapsed_ms,
                        processed_seconds: None,
                        tmp_output_path: Some(tmp_str.clone()),
                        segments: Some(vec![tmp_str]),
                    });
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

fn build_video_tmp_output_path(input: &Path) -> PathBuf {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}.compressed.tmp.{ext}"))
}
