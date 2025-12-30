use crate::ffui_core::domain::{JobRecord, QueueState, QueueStateLite};
use serde::{Deserialize, Serialize};

pub(super) enum DecodedPersistedQueueState {
    Full(QueueState),
    Lite(QueueStateLite),
    V1(PersistedQueueStateFile),
}

pub(super) const PERSISTED_QUEUE_STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PersistedQueueStateFile {
    pub version: u32,
    #[serde(default)]
    pub snapshot_revision: u64,
    pub jobs: Vec<JobRecord>,
}

fn contains_queue_state_lite_marker(data: &[u8]) -> bool {
    const PATTERN_CAMEL: &[u8] = br#""snapshotRevision""#;
    const PATTERN_SNAKE: &[u8] = br#""snapshot_revision""#;
    const PATTERN_FIRST_RUN: &[u8] = br#""firstRunCommand""#;
    data.windows(PATTERN_CAMEL.len())
        .any(|w| w == PATTERN_CAMEL)
        || data
            .windows(PATTERN_SNAKE.len())
            .any(|w| w == PATTERN_SNAKE)
        || data
            .windows(PATTERN_FIRST_RUN.len())
            .any(|w| w == PATTERN_FIRST_RUN)
}

fn contains_queue_state_full_marker(data: &[u8]) -> bool {
    const PATTERN_LOGS: &[u8] = br#""logs""#;
    const PATTERN_RUNS: &[u8] = br#""runs""#;
    data.windows(PATTERN_LOGS.len()).any(|w| w == PATTERN_LOGS)
        || data.windows(PATTERN_RUNS.len()).any(|w| w == PATTERN_RUNS)
}

pub(super) fn decode_persisted_queue_state_bytes(
    data: &[u8],
) -> Option<DecodedPersistedQueueState> {
    // Backward-compatibility: older versions persisted the full QueueState
    // including logs. Newer versions may persist QueueStateLite to avoid
    // heavy log cloning on hot paths.
    if let Ok(v1) = serde_json::from_slice::<PersistedQueueStateFile>(data) {
        return Some(DecodedPersistedQueueState::V1(v1));
    }
    if contains_queue_state_lite_marker(data) {
        if let Ok(lite) = serde_json::from_slice::<QueueStateLite>(data) {
            return Some(DecodedPersistedQueueState::Lite(lite));
        }
    } else if contains_queue_state_full_marker(data)
        && let Ok(full) = serde_json::from_slice::<QueueState>(data)
    {
        return Some(DecodedPersistedQueueState::Full(full));
    }
    if let Ok(lite) = serde_json::from_slice::<QueueStateLite>(data) {
        return Some(DecodedPersistedQueueState::Lite(lite));
    }
    if let Ok(full) = serde_json::from_slice::<QueueState>(data) {
        return Some(DecodedPersistedQueueState::Full(full));
    }
    None
}

#[cfg(feature = "bench")]
pub(super) fn decode_persisted_queue_state_bytes_for_bench(data: &[u8]) -> Option<QueueState> {
    use crate::ffui_core::domain::TranscodeJobLite;

    match decode_persisted_queue_state_bytes(data)? {
        DecodedPersistedQueueState::Full(full) => Some(full),
        DecodedPersistedQueueState::Lite(lite) => Some(QueueState::from(lite)),
        DecodedPersistedQueueState::V1(v1) => {
            let lite = QueueStateLite {
                snapshot_revision: v1.snapshot_revision,
                jobs: v1.jobs.into_iter().map(TranscodeJobLite::from).collect(),
            };
            Some(QueueState::from(lite))
        }
    }
}
