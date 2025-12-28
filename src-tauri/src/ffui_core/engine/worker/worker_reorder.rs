use std::collections::{HashSet, VecDeque};
use std::sync::Arc;

use super::super::state::{Inner, notify_queue_listeners};
use crate::sync_ext::MutexExt;

/// Reorder the waiting queue according to the provided ordered job ids.
/// Job ids not present in `ordered_ids` keep their relative order at the
/// tail of the queue so the operation is resilient to partial payloads.
pub(crate) fn reorder_waiting_jobs(inner: &Arc<Inner>, ordered_ids: Vec<String>) -> bool {
    if ordered_ids.is_empty() {
        return true;
    }

    {
        let mut state = inner.state.lock_unpoisoned();
        if !state.queue.is_empty() {
            let ordered_set: HashSet<String> = ordered_ids.iter().cloned().collect();

            // Preserve any ids that are currently in the queue but not covered
            // by the payload so we never "lose" jobs due to a truncated list.
            let mut remaining: VecDeque<String> = state
                .queue
                .iter()
                .filter(|id| !ordered_set.contains(*id))
                .cloned()
                .collect();

            let mut next_queue: VecDeque<String> = VecDeque::new();

            for id in ordered_ids {
                if state.jobs.contains_key(&id)
                    && state.queue.contains(&id)
                    && !next_queue.contains(&id)
                {
                    next_queue.push_back(id.clone());
                }
            }

            // Append any remaining jobs that were not explicitly reordered.
            while let Some(id) = remaining.pop_front() {
                if !next_queue.contains(&id) {
                    next_queue.push_back(id);
                }
            }

            if next_queue != state.queue {
                state.queue = next_queue;
            }
        }
    };

    // Always emit a queue snapshot for accepted reorder requests so the frontend
    // can observe a new snapshot revision and avoid slow refresh fallbacks.
    notify_queue_listeners(inner);

    // "ok": even if the queue is already in the requested order.
    true
}
