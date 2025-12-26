use std::path::PathBuf;
use std::sync::Arc;

use crate::ffui_core::domain::JobStatus;
use crate::sync_ext::MutexExt;

use super::super::super::state::{Inner, notify_queue_listeners};
use super::super::cleanup::collect_job_tmp_cleanup_paths;

/// Permanently delete all Batch Compress child jobs for a given batch id.
///
/// 语义约定：
/// - 仅当该批次的所有子任务均已处于终态（Completed/Failed/Skipped/Cancelled）且 当前没有处于
///   `active_jobs` 状态时才执行删除；否则直接返回 false，不做任何修改；
/// - 删除成功后会同时清理队列中的相关 bookkeeping（queue / cancelled / wait / restart）；
/// - 当该批次所有子任务都被移除后，连同 `batch_compress_batches` 中的批次元数据一并移除，
///   这样前端复合任务卡片也会从队列中消失。
pub(in crate::ffui_core::engine) fn delete_batch_compress_batch(
    inner: &Arc<Inner>,
    batch_id: &str,
) -> bool {
    use crate::ffui_core::engine::state::BatchCompressBatchStatus;

    let mut cleanup_paths: Vec<PathBuf> = Vec::new();
    {
        let mut state = inner.state.lock_unpoisoned();

        let batch_opt = state.batch_compress_batches.get(batch_id).cloned();
        if let Some(batch) = batch_opt.as_ref()
            && matches!(batch.status, BatchCompressBatchStatus::Scanning)
        {
            // Defensive: avoid deleting a batch that is still scanning and may
            // enqueue more jobs concurrently.
            return false;
        }

        // Backward compatibility: older persisted queues may contain child
        // jobs with `batch_id` but have no in-memory `batch_compress_batches`
        // metadata after crash recovery. In that case derive children from
        // the jobs map and delete the batch safely based on job terminality.
        let child_job_ids: Vec<String> = state
            .jobs
            .iter()
            .filter_map(|(id, job)| {
                if job.batch_id.as_deref() == Some(batch_id) {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        if child_job_ids.is_empty() {
            // No children found in current engine state. If batch metadata exists,
            // fall back to the legacy "logical completion" heuristic so empty
            // batches (e.g. missing preset) remain deletable.
            let Some(batch) = batch_opt else {
                return false;
            };

            let batch_is_deletable = matches!(batch.status, BatchCompressBatchStatus::Completed)
                || (!matches!(batch.status, BatchCompressBatchStatus::Scanning)
                    && batch.total_processed >= batch.total_candidates);
            if !batch_is_deletable {
                return false;
            }
        } else {
            // Ensure every child is terminal and not currently active.
            for job_id in &child_job_ids {
                let Some(job) = state.jobs.get(job_id) else {
                    continue;
                };

                match job.status {
                    JobStatus::Completed
                    | JobStatus::Failed
                    | JobStatus::Skipped
                    | JobStatus::Cancelled => {
                        if state.active_jobs.contains(job_id.as_str()) {
                            return false;
                        }
                    }
                    _ => {
                        // Keep the same defensive semantics as delete_job:
                        // non-terminal jobs cannot be deleted in bulk.
                        return false;
                    }
                }
            }

            for job_id in &child_job_ids {
                if let Some(job) = state.jobs.get(job_id) {
                    cleanup_paths.extend(collect_job_tmp_cleanup_paths(job));
                }
            }

            for job_id in &child_job_ids {
                state.queue.retain(|id| id != job_id);
                state.cancelled_jobs.remove(job_id);
                state.wait_requests.remove(job_id);
                state.restart_requests.remove(job_id);
                state.jobs.remove(job_id);
            }
        }

        state.batch_compress_batches.remove(batch_id);
    }

    notify_queue_listeners(inner);

    for path in cleanup_paths {
        drop(std::fs::remove_file(path));
    }
    true
}
