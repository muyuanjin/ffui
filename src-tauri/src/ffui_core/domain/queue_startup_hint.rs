use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueStartupHintKind {
    CrashOrKill,
    PauseOnExit,
    NormalRestart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStartupHint {
    pub kind: QueueStartupHintKind,
    pub auto_paused_job_count: usize,
}
