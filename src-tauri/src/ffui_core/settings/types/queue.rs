use serde::{Deserialize, Serialize};

/// Controls how taskbar progress is aggregated from the queue.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::enum_variant_names)]
pub enum TaskbarProgressMode {
    /// Simple aggregation by file size; stable but less accurate.
    BySize,
    /// Weight jobs by media duration in seconds when available.
    ByDuration,
    /// Weight jobs by an estimated processing time derived from historical
    /// preset statistics, falling back to duration/size heuristics.
    #[default]
    ByEstimatedTime,
}

/// 控制任务栏进度计算时纳入哪些任务。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TaskbarProgressScope {
    /// 与现有行为一致：所有任务（含已结束）都会参与聚合。
    #[default]
    AllJobs,
    /// 仅统计仍在排队或进行中的任务；若队列全部终态则回退为全部任务以显示 100%。
    ActiveAndQueued,
}

/// Queue persistence mode for crash-recovery. This controls whether the
/// engine writes queue-state snapshots to disk and attempts to restore them
/// on startup.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum QueuePersistenceMode {
    /// Do not persist or restore the queue at all. This is the default and
    /// treats the queue as an in-memory session without crash recovery.
    #[default]
    None,
    /// Persist lightweight queue snapshots (no full logs) for crash recovery.
    #[serde(alias = "crashRecovery")]
    CrashRecoveryLite,
    /// Persist lightweight queue snapshots plus per-job full logs for terminal
    /// jobs, so users can still inspect full logs after a restart.
    CrashRecoveryFull,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecoveryLogRetention {
    /// Maximum number of per-job terminal log files to keep on disk. When None,
    /// a conservative default will be applied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_files: Option<u16>,
    /// Maximum total size in megabytes for all terminal log files. When None,
    /// a conservative default will be applied.
    #[serde(skip_serializing_if = "Option::is_none", alias = "maxTotalMB")]
    pub max_total_mb: Option<u16>,
}

impl Default for CrashRecoveryLogRetention {
    fn default() -> Self {
        Self {
            max_files: Some(200),
            max_total_mb: Some(512),
        }
    }
}
