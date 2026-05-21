use std::sync::Arc;

use crate::ffui_core::domain::{
    AutoCompressProgress, ImageTargetFormat, OutputPolicy, QueueState, QueueStateLite,
    QueueStateLiteDelta, QueueStateUiLite, SavingConditionType,
};
use std::collections::HashSet;

pub(in crate::ffui_core::engine) const BATCH_COMPRESS_PROGRESS_EVERY: u64 = 32;

pub(in crate::ffui_core::engine) type QueueListener =
    Arc<dyn Fn(QueueState) + Send + Sync + 'static>;
pub(in crate::ffui_core::engine) type QueueLiteListener =
    Arc<dyn Fn(QueueStateLite) + Send + Sync + 'static>;
pub(in crate::ffui_core::engine) type QueueUiLiteListener =
    Arc<dyn Fn(QueueStateUiLite) + Send + Sync + 'static>;
pub(in crate::ffui_core::engine) type QueueLiteDeltaListener =
    Arc<dyn Fn(QueueStateLiteDelta) + Send + Sync + 'static>;
pub(in crate::ffui_core::engine) type BatchCompressProgressListener =
    Arc<dyn Fn(AutoCompressProgress) + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BatchCompressBatchStatus {
    Scanning,
    Running,
    Completed,
    #[allow(dead_code)]
    Failed,
}

#[derive(Debug, Clone)]
pub(crate) struct BatchCompressBatch {
    pub(crate) batch_id: String,
    pub(crate) root_path: String,
    // Runtime-only batch config; media children must also carry job snapshots for recovery.
    /// 当前批次是否在压缩完成后替换原文件（移动到回收站并更新输出路径）。
    pub(crate) replace_original: bool,
    pub(crate) min_image_size_kb: u64,
    pub(crate) min_audio_size_kb: u64,
    pub(crate) image_target_format: ImageTargetFormat,
    pub(crate) output_policy: OutputPolicy,
    pub(crate) saving_condition_type: SavingConditionType,
    pub(crate) min_saving_ratio: f64,
    pub(crate) min_saving_absolute_mb: f64,
    pub(crate) status: BatchCompressBatchStatus,
    pub(crate) total_files_scanned: u64,
    pub(crate) total_candidates: u64,
    pub(crate) total_processed: u64,
    pub(crate) child_job_ids: Vec<String>,
    pub(crate) processed_child_job_ids: HashSet<String>,
    #[allow(dead_code)]
    pub(crate) started_at_ms: u64,
    pub(crate) completed_at_ms: Option<u64>,
}

impl BatchCompressBatch {
    pub(crate) fn new(batch_id: String, root_path: String, started_at_ms: u64) -> Self {
        let defaults = crate::ffui_core::domain::BatchCompressConfig::default();
        Self {
            batch_id,
            root_path,
            replace_original: defaults.replace_original,
            min_image_size_kb: defaults.min_image_size_kb,
            min_audio_size_kb: defaults.min_audio_size_kb,
            image_target_format: defaults.image_target_format,
            output_policy: defaults.output_policy,
            saving_condition_type: defaults.saving_condition_type,
            min_saving_ratio: defaults.min_saving_ratio,
            min_saving_absolute_mb: defaults.min_saving_absolute_mb,
            status: BatchCompressBatchStatus::Scanning,
            total_files_scanned: 0,
            total_candidates: 0,
            total_processed: 0,
            child_job_ids: Vec::new(),
            processed_child_job_ids: Default::default(),
            started_at_ms,
            completed_at_ms: None,
        }
    }
}
