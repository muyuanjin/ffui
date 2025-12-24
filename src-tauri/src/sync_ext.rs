use std::sync::{
    Condvar,
    Mutex,
    MutexGuard,
    PoisonError,
    RwLock,
    RwLockReadGuard,
    RwLockWriteGuard,
    WaitTimeoutResult,
};
use std::time::Duration;

pub(crate) trait MutexExt<T> {
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T>;
}

impl<T> MutexExt<T> for Mutex<T> {
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) trait RwLockExt<T> {
    fn read_unpoisoned(&self) -> RwLockReadGuard<'_, T>;
    fn write_unpoisoned(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> RwLockExt<T> for RwLock<T> {
    fn read_unpoisoned(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write_unpoisoned(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(PoisonError::into_inner)
    }
}

pub(crate) trait CondvarExt {
    fn wait_unpoisoned<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T>;

    fn wait_timeout_unpoisoned<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        dur: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult);

    fn wait_while_unpoisoned<'a, T, F>(
        &self,
        guard: MutexGuard<'a, T>,
        condition: F,
    ) -> MutexGuard<'a, T>
    where
        F: FnMut(&mut T) -> bool;
}

impl CondvarExt for Condvar {
    fn wait_unpoisoned<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T> {
        self.wait(guard).unwrap_or_else(PoisonError::into_inner)
    }

    fn wait_timeout_unpoisoned<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        dur: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult) {
        self.wait_timeout(guard, dur)
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn wait_while_unpoisoned<'a, T, F>(
        &self,
        guard: MutexGuard<'a, T>,
        condition: F,
    ) -> MutexGuard<'a, T>
    where
        F: FnMut(&mut T) -> bool, {
        self.wait_while(guard, condition)
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        Condvar,
        Mutex,
        RwLock,
    };
    use std::time::Duration;

    use super::*;

    #[test]
    fn mutex_ext_recovers_from_poison() {
        let lock = Arc::new(Mutex::new(1u32));
        let lock_clone = lock.clone();
        let _ = std::thread::spawn(move || {
            let _guard = lock_clone.lock().unwrap();
            panic!("poison mutex");
        })
        .join();

        let mut guard = lock.lock_unpoisoned();
        *guard += 1;
        assert_eq!(*guard, 2);
    }

    #[test]
    fn rwlock_ext_recovers_from_poison() {
        let lock = Arc::new(RwLock::new(1u32));
        let lock_clone = lock.clone();
        let _ = std::thread::spawn(move || {
            let mut guard = lock_clone.write().unwrap();
            *guard += 1;
            panic!("poison rwlock");
        })
        .join();

        let guard = lock.read_unpoisoned();
        assert_eq!(*guard, 2);
    }

    #[test]
    fn condvar_ext_wait_timeout_recovers_from_poison() {
        let lock = Arc::new(Mutex::new(1u32));
        let lock_clone = lock.clone();
        let _ = std::thread::spawn(move || {
            let _guard = lock_clone.lock().unwrap();
            panic!("poison mutex for condvar");
        })
        .join();

        let cv = Condvar::new();
        let guard = lock.lock_unpoisoned();
        let (guard, _timeout) = cv.wait_timeout_unpoisoned(guard, Duration::from_millis(0));
        assert_eq!(*guard, 1);
    }
}
