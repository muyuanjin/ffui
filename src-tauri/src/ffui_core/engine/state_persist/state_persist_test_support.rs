use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use once_cell::sync::Lazy;

use crate::sync_ext::MutexExt;

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

static PERSIST_TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

thread_local! {
    static PERSIST_TEST_MUTEX_HELD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub(crate) struct PersistTestMutexGuard {
    _guard: Option<MutexGuard<'static, ()>>,
    _reset: Option<PersistTestMutexReset>,
}

struct PersistTestMutexReset;

impl Drop for PersistTestMutexReset {
    fn drop(&mut self) {
        PERSIST_TEST_MUTEX_HELD.with(|flag| flag.set(false));
    }
}

pub(crate) fn lock_persist_test_mutex_for_tests() -> PersistTestMutexGuard {
    use std::cell::Cell;

    if PERSIST_TEST_MUTEX_HELD.with(Cell::get) {
        return PersistTestMutexGuard {
            _guard: None,
            _reset: None,
        };
    }

    let guard = PERSIST_TEST_MUTEX.lock_unpoisoned();
    PERSIST_TEST_MUTEX_HELD.with(|flag| flag.set(true));
    PersistTestMutexGuard {
        _guard: Some(guard),
        _reset: Some(PersistTestMutexReset),
    }
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
