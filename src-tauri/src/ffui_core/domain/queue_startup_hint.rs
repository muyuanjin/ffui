use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QueueStartupHintKind {
    CrashOrKill,
    PauseOnExit,
    PausedQueue,
    NormalRestart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueueStartupHint {
    pub kind: QueueStartupHintKind,
    #[specta(type = specta_typescript::Number<usize>)]
    pub auto_paused_job_count: usize,
}
