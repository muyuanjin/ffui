use std::sync::Arc;

use crate::ffui_core::domain::{
    AutoCompressProgress, QueueState, QueueStateLite, QueueStateLiteDelta,
};

pub(in crate::ffui_core::engine) const BATCH_COMPRESS_PROGRESS_EVERY: u64 = 32;

pub(in crate::ffui_core::engine) type QueueListener =
    Arc<dyn Fn(QueueState) + Send + Sync + 'static>;
pub(in crate::ffui_core::engine) type QueueLiteListener =
    Arc<dyn Fn(QueueStateLite) + Send + Sync + 'static>;
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
    /// 当前批次是否在压缩完成后替换原文件（移动到回收站并更新输出路径）。
    pub(crate) replace_original: bool,
    pub(crate) status: BatchCompressBatchStatus,
    pub(crate) total_files_scanned: u64,
    pub(crate) total_candidates: u64,
    pub(crate) total_processed: u64,
    pub(crate) child_job_ids: Vec<String>,
    #[allow(dead_code)]
    pub(crate) started_at_ms: u64,
    pub(crate) completed_at_ms: Option<u64>,
}
