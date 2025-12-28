use std::collections::HashMap;

use crate::ffui_core::{
    JobStatus, QueueStateLiteDelta, QueueStateUiLite, TaskbarProgressMode, TaskbarProgressScope,
};

#[derive(Debug, Clone)]
struct JobSnapshot {
    status: JobStatus,
    progress: f64,
    start_time: Option<u64>,
    size_mb: f64,
    duration_seconds: f64,
    estimated_seconds: Option<f64>,
}

impl JobSnapshot {
    fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            JobStatus::Completed | JobStatus::Failed | JobStatus::Skipped | JobStatus::Cancelled
        )
    }

    fn normalized_progress(&self) -> f64 {
        if self.is_terminal() {
            1.0
        } else {
            match self.status {
                JobStatus::Processing | JobStatus::Paused => {
                    (self.progress.clamp(0.0, 100.0)) / 100.0
                }
                _ => 0.0,
            }
        }
    }

    fn weight(&self, mode: TaskbarProgressMode) -> f64 {
        super::taskbar_progress_weight(
            mode,
            self.size_mb,
            self.duration_seconds,
            self.estimated_seconds,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrackerConfig {
    mode: TaskbarProgressMode,
    scope: TaskbarProgressScope,
}

/// Incremental taskbar-progress aggregation for QueueStateUiLite + QueueStateLiteDelta.
///
/// The tracker maintains the weighted sum for the currently configured
/// (mode, scope) pair and updates in O(patches) for progress deltas. It falls
/// back to a full O(N) rebuild only when cohort membership changes for
/// `ActiveAndQueued` scope (job start/finish transitions).
#[derive(Debug, Default)]
pub struct TaskbarProgressDeltaTracker {
    base_snapshot_revision: Option<u64>,
    jobs: HashMap<String, JobSnapshot>,
    job_count: usize,
    terminal_count: usize,

    config: Option<TrackerConfig>,
    total_weight: f64,
    weighted_total: f64,

    // Active scope bookkeeping (min over non-terminal start times with a value).
    non_terminal_count: usize,
    non_terminal_min_start_time: Option<u64>,

    #[cfg(test)]
    full_rebuilds: u64,
}

impl TaskbarProgressDeltaTracker {
    pub fn base_snapshot_revision(&self) -> Option<u64> {
        self.base_snapshot_revision
    }

    pub fn completed_queue(&self) -> bool {
        self.job_count > 0 && self.terminal_count == self.job_count
    }

    pub fn progress(&self) -> Option<f64> {
        if self.job_count == 0 {
            return None;
        }
        if self.total_weight <= 0.0 {
            return None;
        }
        Some((self.weighted_total / self.total_weight).clamp(0.0, 1.0))
    }

    pub fn reset_from_ui_lite(
        &mut self,
        snapshot: &QueueStateUiLite,
        mode: TaskbarProgressMode,
        scope: TaskbarProgressScope,
    ) {
        self.base_snapshot_revision = Some(snapshot.snapshot_revision);
        self.jobs.clear();
        self.job_count = snapshot.jobs.len();
        self.terminal_count = 0;
        self.non_terminal_count = 0;
        self.non_terminal_min_start_time = None;

        for job in &snapshot.jobs {
            let size_mb = job
                .media_info
                .as_ref()
                .and_then(|m| m.size_mb)
                .unwrap_or(job.original_size_mb);
            let duration_seconds = job
                .media_info
                .as_ref()
                .and_then(|m| m.duration_seconds)
                .unwrap_or(0.0);

            let snap = JobSnapshot {
                status: job.status,
                progress: job.progress,
                start_time: job.start_time,
                size_mb,
                duration_seconds,
                estimated_seconds: job.estimated_seconds,
            };
            if snap.is_terminal() {
                self.terminal_count += 1;
            } else {
                self.non_terminal_count += 1;
                if let Some(t) = snap.start_time {
                    self.non_terminal_min_start_time = match self.non_terminal_min_start_time {
                        Some(prev) => Some(prev.min(t)),
                        None => Some(t),
                    };
                }
            }
            self.jobs.insert(job.id.clone(), snap);
        }

        self.config = Some(TrackerConfig { mode, scope });
        self.rebuild_totals();
    }

    pub fn apply_delta(
        &mut self,
        delta: &QueueStateLiteDelta,
        mode: TaskbarProgressMode,
        scope: TaskbarProgressScope,
    ) {
        let Some(base) = self.base_snapshot_revision else {
            return;
        };
        if base != delta.base_snapshot_revision {
            return;
        }

        let cfg = TrackerConfig { mode, scope };
        if self.config != Some(cfg) {
            self.config = Some(cfg);
            self.rebuild_totals();
        }

        let Some(cfg) = self.config else {
            return;
        };

        let pre_delta_non_terminal_count = self.non_terminal_count;
        let pre_delta_min = self.non_terminal_min_start_time;
        let mut cohort_recompute_needed = false;

        for patch in &delta.patches {
            let Some(old_job) = self.jobs.get(&patch.id).cloned() else {
                continue;
            };

            let (was_eligible, old_weighted, old_weight) = self.contribution(&old_job, cfg);
            if was_eligible {
                self.weighted_total -= old_weighted;
                self.total_weight -= old_weight;
            }

            let old_terminal = old_job.is_terminal();

            let new_job = {
                let Some(job) = self.jobs.get_mut(&patch.id) else {
                    continue;
                };
                Self::apply_patch_fields(job, patch);
                job.clone()
            };

            let new_terminal = new_job.is_terminal();
            if old_terminal != new_terminal {
                cohort_recompute_needed = true;
                if old_terminal {
                    self.terminal_count = self.terminal_count.saturating_sub(1);
                    self.non_terminal_count += 1;
                    if let Some(t) = new_job.start_time {
                        match self.non_terminal_min_start_time {
                            Some(prev) => {
                                if t < prev {
                                    self.non_terminal_min_start_time = Some(t);
                                }
                            }
                            None => {
                                self.non_terminal_min_start_time = Some(t);
                            }
                        }
                    }
                } else {
                    self.terminal_count += 1;
                    self.non_terminal_count = self.non_terminal_count.saturating_sub(1);
                }
            }

            let (is_eligible, new_weighted, new_weight) = self.contribution(&new_job, cfg);
            if is_eligible {
                self.weighted_total += new_weighted;
                self.total_weight += new_weight;
            }
        }

        if cfg.scope == TaskbarProgressScope::ActiveAndQueued && cohort_recompute_needed {
            self.recompute_active_cohort_start_time();
            let cohort_changed = pre_delta_non_terminal_count == 0
                || self.non_terminal_count == 0
                || self.non_terminal_min_start_time != pre_delta_min;
            if cohort_changed {
                self.rebuild_totals();
            }
        }
    }

    fn apply_patch_fields(
        job: &mut JobSnapshot,
        patch: &crate::ffui_core::TranscodeJobLiteDeltaPatch,
    ) {
        if let Some(status) = patch.status {
            job.status = status;
        }
        if let Some(progress) = patch.progress {
            job.progress = progress;
        }
    }

    fn active_cohort_start_time(&self) -> Option<u64> {
        if self.non_terminal_count == 0 {
            return None;
        }
        self.non_terminal_min_start_time
    }

    fn eligible(&self, job: &JobSnapshot, cfg: TrackerConfig) -> bool {
        match cfg.scope {
            TaskbarProgressScope::AllJobs => true,
            TaskbarProgressScope::ActiveAndQueued => {
                if self.non_terminal_count == 0 {
                    return true;
                }
                if !job.is_terminal() {
                    return true;
                }
                self.active_cohort_start_time()
                    .is_some_and(|start| job.start_time.is_some_and(|t| t >= start))
            }
        }
    }

    fn contribution(&self, job: &JobSnapshot, cfg: TrackerConfig) -> (bool, f64, f64) {
        let eligible = self.eligible(job, cfg);
        if !eligible {
            return (false, 0.0, 0.0);
        }
        let w = job.weight(cfg.mode);
        let p = job.normalized_progress();
        (true, w * p, w)
    }

    fn recompute_active_cohort_start_time(&mut self) {
        self.non_terminal_min_start_time = None;
        if self.non_terminal_count == 0 {
            return;
        }
        for job in self.jobs.values() {
            if job.is_terminal() {
                continue;
            }
            if let Some(t) = job.start_time {
                self.non_terminal_min_start_time = match self.non_terminal_min_start_time {
                    Some(prev) => Some(prev.min(t)),
                    None => Some(t),
                };
            }
        }
    }

    fn rebuild_totals(&mut self) {
        self.total_weight = 0.0;
        self.weighted_total = 0.0;
        let Some(cfg) = self.config else {
            return;
        };
        for job in self.jobs.values() {
            let (eligible, weighted, weight) = self.contribution(job, cfg);
            if eligible {
                self.weighted_total += weighted;
                self.total_weight += weight;
            }
        }

        #[cfg(test)]
        {
            self.full_rebuilds = self.full_rebuilds.saturating_add(1);
        }
    }

    #[cfg(test)]
    fn full_rebuilds_for_tests(&self) -> u64 {
        self.full_rebuilds
    }
}

#[cfg(test)]
#[path = "taskbar_progress_delta_tests.rs"]
mod taskbar_progress_delta_tests;
