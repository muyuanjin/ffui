use super::super::state_persist;
use super::restore;
use crate::ffui_core::TranscodingEngine;
use crate::ffui_core::domain::JobStatus;
use crate::ffui_core::engine::segment_discovery;
use crate::sync_ext::MutexExt;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct QueueRestoreBenchRun {
    pub file_bytes: usize,
    pub jobs: usize,
    pub read_time: Duration,
    pub decode_time: Duration,
    pub restore_time: Duration,
    pub restore_segment_dir_scans: usize,
    pub jobs_with_wait_metadata: usize,
    pub resume_time: Duration,
    pub resume_resumed_jobs: usize,
    pub resume_segment_dir_scans: usize,
    pub jobs_with_wait_metadata_after_resume: usize,
}

#[derive(Debug, Clone)]
pub struct QueueRestoreBenchReport {
    pub path: String,
    pub runs: Vec<QueueRestoreBenchRun>,
}

fn read_and_decode_queue_state(
    path: &Path,
) -> anyhow::Result<(
    usize,
    Duration,
    Duration,
    crate::ffui_core::domain::QueueState,
)> {
    let read_started = Instant::now();
    let bytes = std::fs::read(path)
        .map_err(|e| anyhow::anyhow!("failed to read {}: {e}", path.display()))?;
    let read_time = read_started.elapsed();

    let decode_started = Instant::now();
    let decoded = state_persist::decode_persisted_queue_state_bytes_for_bench(&bytes)
        .ok_or_else(|| anyhow::anyhow!("failed to decode persisted queue state bytes"))?;
    let decode_time = decode_started.elapsed();

    Ok((bytes.len(), read_time, decode_time, decoded))
}

pub fn bench_restore_queue_state_file(
    path: &Path,
    repeat: usize,
) -> anyhow::Result<QueueRestoreBenchReport> {
    let repeat = repeat.max(1);
    let mut runs: Vec<QueueRestoreBenchRun> = Vec::with_capacity(repeat);

    for _ in 0..repeat {
        segment_discovery::reset_list_segment_candidates_calls_for_tests();

        let (file_bytes, read_time, decode_time, snapshot) = read_and_decode_queue_state(path)?;
        let jobs = snapshot.jobs.len();

        let engine = TranscodingEngine::new_for_tests();

        let restore_started = Instant::now();
        restore::restore_jobs_from_snapshot(engine.inner.as_ref(), snapshot);
        let restore_time = restore_started.elapsed();

        let restore_segment_dir_scans =
            segment_discovery::list_segment_candidates_calls_for_tests();
        let jobs_with_wait_metadata = {
            let state = engine.inner.state.lock_unpoisoned();
            state
                .jobs
                .values()
                .filter(|j| j.wait_metadata.is_some())
                .count()
        };

        // Mimic the `restore_jobs_from_persisted_queue` behaviour: if no jobs
        // were auto-paused by recovery logic, offer resuming the paused queue.
        {
            let paused_queue_ids: Vec<String> = {
                let state = engine.inner.state.lock_unpoisoned();
                state
                    .queue
                    .iter()
                    .filter(|id| {
                        state
                            .jobs
                            .get(*id)
                            .is_some_and(|job| job.status == JobStatus::Paused)
                    })
                    .cloned()
                    .collect()
            };
            if !paused_queue_ids.is_empty() {
                let mut guard = engine.inner.startup_auto_paused_job_ids.lock_unpoisoned();
                if guard.is_empty() {
                    guard.extend(paused_queue_ids);
                }
            }
        }

        segment_discovery::reset_list_segment_candidates_calls_for_tests();
        let resume_started = Instant::now();
        let resume_resumed_jobs = engine.resume_startup_auto_paused_jobs();
        let resume_time = resume_started.elapsed();
        let resume_segment_dir_scans = segment_discovery::list_segment_candidates_calls_for_tests();
        let jobs_with_wait_metadata_after_resume = {
            let state = engine.inner.state.lock_unpoisoned();
            state
                .jobs
                .values()
                .filter(|j| j.wait_metadata.is_some())
                .count()
        };

        runs.push(QueueRestoreBenchRun {
            file_bytes,
            jobs,
            read_time,
            decode_time,
            restore_time,
            restore_segment_dir_scans,
            jobs_with_wait_metadata,
            resume_time,
            resume_resumed_jobs,
            resume_segment_dir_scans,
            jobs_with_wait_metadata_after_resume,
        });
    }

    Ok(QueueRestoreBenchReport {
        path: path.to_string_lossy().into_owned(),
        runs,
    })
}
