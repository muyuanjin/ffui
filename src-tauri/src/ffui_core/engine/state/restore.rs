use super::super::state_persist::{load_persisted_queue_state, load_persisted_terminal_job_logs};
use super::super::worker_utils::{append_job_log_line, recompute_log_tail};
use super::Inner;
use crate::ffui_core::ShutdownMarkerKind;
use crate::ffui_core::domain::{JobStatus, QueueStartupHint, QueueStartupHintKind, QueueState};
use crate::ffui_core::settings::types::QueuePersistenceMode;
use crate::sync_ext::MutexExt;
use std::collections::{HashSet, VecDeque};
pub(in crate::ffui_core::engine) fn restore_jobs_from_persisted_queue(inner: &Inner) {
    let (mode, retention) = {
        let state = inner.state.lock_unpoisoned();
        (
            state.settings.queue_persistence_mode,
            state.settings.crash_recovery_log_retention,
        )
    };
    let Some(snapshot) = load_persisted_queue_state() else {
        return;
    };
    let mut snapshot = match mode {
        QueuePersistenceMode::CrashRecoveryLite | QueuePersistenceMode::CrashRecoveryFull => {
            snapshot
        }
        QueuePersistenceMode::None => {
            // When crash recovery persistence is disabled we still allow restoring
            // non-terminal jobs (paused/waiting) that were flushed during graceful
            // shutdown so "pause on exit" remains meaningful.
            let mut snapshot = snapshot;
            snapshot.jobs.retain(|j| {
                matches!(
                    j.status,
                    JobStatus::Queued | JobStatus::Paused | JobStatus::Processing
                )
            });
            if snapshot.jobs.is_empty() {
                return;
            }
            snapshot
        }
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

    if !terminal_logs.is_empty() {
        use std::collections::HashMap;
        let map: HashMap<String, Vec<crate::ffui_core::domain::JobRun>> =
            terminal_logs.into_iter().collect();
        for job in &mut snapshot.jobs {
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

    let auto_paused_count = inner.startup_auto_paused_job_ids.lock_unpoisoned().len();
    if auto_paused_count == 0 {
        // Do not infer startup auto-paused jobs from any "Paused" status:
        // users can pause jobs manually, and that must not trigger (or be resumed by)
        // the startup recovery prompt.
        return;
    }

    let previous_marker = inner.previous_shutdown_marker.lock_unpoisoned().clone();
    let kind = match previous_marker.as_ref().map(|m| m.kind) {
        Some(ShutdownMarkerKind::CleanAutoWait) => QueueStartupHintKind::PauseOnExit,
        Some(ShutdownMarkerKind::Running) => QueueStartupHintKind::CrashOrKill,
        _ => QueueStartupHintKind::NormalRestart,
    };

    let hint = QueueStartupHint {
        kind,
        auto_paused_job_count: auto_paused_count,
    };
    *inner.queue_startup_hint.lock_unpoisoned() = Some(hint);
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

    let mut recovered_processing: Vec<(u64, String)> = Vec::new();
    let mut waiting_like: Vec<(u64, String)> = Vec::new();
    let mut auto_paused_ids: Vec<String> = Vec::new();
    let auto_wait_processing_ids: HashSet<String> = inner
        .previous_shutdown_marker
        .lock_unpoisoned()
        .as_ref()
        .and_then(|marker| {
            if marker.kind == ShutdownMarkerKind::CleanAutoWait {
                marker.auto_wait_processing_job_ids.as_ref()
            } else {
                None
            }
        })
        .map(|ids| ids.iter().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();

    {
        let mut state = inner.state.lock_unpoisoned();

        for mut job in snapshot.jobs {
            job.ensure_run_history_from_legacy();
            let id = job.id.clone();
            let processing_on_auto_wait_exit = auto_wait_processing_ids.contains(&id);

            // If a job with the same id was already enqueued in this run,
            // keep the in-memory version and skip the persisted one.
            if state.jobs.contains_key(&id) {
                continue;
            }

            let was_processing = job.status == JobStatus::Processing;
            let mut auto_paused = false;

            // Jobs that were previously in Processing are treated as Paused so
            // they do not auto-resume on startup but remain recoverable.
            if job.status == JobStatus::Processing {
                job.status = JobStatus::Paused;
                auto_paused = true;
                append_job_log_line(
                    &mut job,
                    "Recovered after unexpected shutdown; job did not finish in previous run."
                        .to_string(),
                );
                job.log_head = None;
            }

            let persisted_order = job.queue_order;
            job.queue_order = None;

            // Queued jobs should not auto-run on restart. Treat them as paused
            // until the user explicitly resumes the queue.
            if matches!(job.status, JobStatus::Queued) {
                job.status = JobStatus::Paused;
                auto_paused = true;
            }

            // If the previous run exited via "pause on exit", we also treat
            // jobs that were processing at the moment the auto-wait started as
            // auto-paused, even if they already reached Paused before shutdown.
            if !auto_paused && processing_on_auto_wait_exit {
                auto_paused = true;
            }

            // 处理耗时基线属于运行期信息，恢复时清空，待重新进入 Processing 时再设置。
            job.processing_started_ms = None;

            if job.status == JobStatus::Paused {
                if was_processing || processing_on_auto_wait_exit {
                    let key = persisted_order
                        .or(job.processing_started_ms)
                        .or(job.start_time)
                        .unwrap_or(u64::MAX);
                    recovered_processing.push((key, id.clone()));
                } else {
                    let order = persisted_order.unwrap_or(u64::MAX);
                    waiting_like.push((order, id.clone()));
                }
            }

            if auto_paused {
                auto_paused_ids.push(id.clone());
            }

            state.jobs.insert(id, job);
        }

        recovered_processing.sort_by(|(ao, aid), (bo, bid)| ao.cmp(bo).then(aid.cmp(bid)));
        waiting_like.sort_by(|(ao, aid), (bo, bid)| ao.cmp(bo).then(aid.cmp(bid)));

        let mut recovered_ids: Vec<String> = Vec::new();
        recovered_ids.extend(recovered_processing.into_iter().map(|(_, id)| id));
        recovered_ids.extend(waiting_like.into_iter().map(|(_, id)| id));
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

    {
        let mut guard = inner.startup_auto_paused_job_ids.lock_unpoisoned();
        guard.clear();
        guard.extend(auto_paused_ids);
    }

    // Emit a UI snapshot so the frontend sees the recovered queue without
    // forcing a heavy crash-recovery snapshot clone/persist on startup.
    super::notify_queue_ui_lite_listeners(inner);

    // Wake any worker threads that might already be waiting for work so they
    // can immediately observe the recovered queue instead of staying parked
    // on the condition variable until a brand-new job is enqueued.
    inner.cv.notify_all();
}
