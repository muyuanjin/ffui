use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread::ThreadId;

use once_cell::sync::Lazy;

use crate::sync_ext::{CondvarExt, MutexExt};

static QUEUE_STATE_SIDECAR_PATH_OVERRIDE: Lazy<Mutex<Option<PathBuf>>> =
    Lazy::new(|| Mutex::new(None));

pub(crate) struct QueueStateSidecarPathGuard;

impl Drop for QueueStateSidecarPathGuard {
    fn drop(&mut self) {
        let mut override_path = QUEUE_STATE_SIDECAR_PATH_OVERRIDE.lock_unpoisoned();
        *override_path = None;
    }
}

pub(crate) fn override_queue_state_sidecar_path_for_tests(path: PathBuf) -> QueueStateSidecarPathGuard {
    let mut override_path = QUEUE_STATE_SIDECAR_PATH_OVERRIDE.lock_unpoisoned();
    *override_path = Some(path);
    QueueStateSidecarPathGuard
}

pub(super) fn queue_state_sidecar_path_override() -> Option<PathBuf> {
    let override_path = QUEUE_STATE_SIDECAR_PATH_OVERRIDE.lock_unpoisoned();
    override_path.clone()
}

pub(crate) fn queue_state_sidecar_path_overridden_for_tests() -> bool {
    if queue_state_sidecar_path_override().is_some() {
        return true;
    }
    std::env::var("FFUI_QUEUE_STATE_SIDECAR_PATH")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

pub(crate) static QUEUE_PERSIST_WRITE_COUNT: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
struct PersistTestLockState {
    owner: Option<ThreadId>,
    depth: u32,
}

static PERSIST_TEST_LOCK: Lazy<(Mutex<PersistTestLockState>, Condvar)> = Lazy::new(|| {
    (
        Mutex::new(PersistTestLockState {
            owner: None,
            depth: 0,
        }),
        Condvar::new(),
    )
});

pub(crate) struct PersistTestMutexGuard {
    owner: ThreadId,
}

impl Drop for PersistTestMutexGuard {
    fn drop(&mut self) {
        let (lock, cv) = &*PERSIST_TEST_LOCK;
        let mut state = lock.lock_unpoisoned();
        if state.owner != Some(self.owner) || state.depth == 0 {
            return;
        }
        state.depth -= 1;
        if state.depth == 0 {
            state.owner = None;
            cv.notify_all();
        }
    }
}

pub(crate) fn lock_persist_test_mutex_for_tests() -> PersistTestMutexGuard {
    let owner = std::thread::current().id();
    let (lock, cv) = &*PERSIST_TEST_LOCK;
    let mut state = lock.lock_unpoisoned();
    loop {
        match state.owner {
            None => {
                state.owner = Some(owner);
                state.depth = 1;
                bump_queue_persist_epoch_for_tests();
                break;
            }
            Some(current) if current == owner => {
                state.depth = state.depth.saturating_add(1);
                break;
            }
            _ => {
                state = cv.wait_unpoisoned(state);
            }
        }
    }
    drop(state);
    PersistTestMutexGuard { owner }
}

static QUEUE_PERSIST_EPOCH: AtomicU64 = AtomicU64::new(0);

pub(super) fn bump_queue_persist_epoch_for_tests() {
    QUEUE_PERSIST_EPOCH.fetch_add(1, Ordering::SeqCst);
}

pub(super) fn current_queue_persist_epoch_for_tests() -> u64 {
    QUEUE_PERSIST_EPOCH.load(Ordering::SeqCst)
}

pub(super) fn should_abort_queue_persist_write_for_tests(epoch: u64) -> bool {
    epoch != QUEUE_PERSIST_EPOCH.load(Ordering::SeqCst)
}
