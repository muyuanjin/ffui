use serde::{Deserialize, Serialize};

pub const DEFAULT_MAX_PARALLEL_JOBS: u8 = 2;
pub const DEFAULT_MAX_PARALLEL_CPU_JOBS: u8 = 2;
pub const DEFAULT_MAX_PARALLEL_HW_JOBS: u8 = 1;

pub const MAX_PARALLEL_JOBS_LIMIT: u8 = 32;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscodeParallelismMode {
    #[default]
    Unified,
    Split,
}
