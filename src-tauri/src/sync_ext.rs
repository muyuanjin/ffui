use std::sync::{
    Condvar, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard, WaitTimeoutResult,
};
use std::time::Duration;

pub trait MutexExt<T> {
    #[track_caller]
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T>;
}

impl<T> MutexExt<T> for Mutex<T> {
    #[track_caller]
    fn lock_unpoisoned(&self) -> MutexGuard<'_, T> {
        match self.lock() {
            Ok(guard) => guard,
            Err(err) => {
                let loc = std::panic::Location::caller();
                eprintln!(
                    "poisoned mutex recovered at {}:{}:{}",
                    loc.file(),
                    loc.line(),
                    loc.column()
                );
                err.into_inner()
            }
        }
    }
}

pub trait RwLockExt<T> {
    #[track_caller]
    fn read_unpoisoned(&self) -> RwLockReadGuard<'_, T>;
    #[track_caller]
    fn write_unpoisoned(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> RwLockExt<T> for RwLock<T> {
    #[track_caller]
    fn read_unpoisoned(&self) -> RwLockReadGuard<'_, T> {
        match self.read() {
            Ok(guard) => guard,
            Err(err) => {
                let loc = std::panic::Location::caller();
                eprintln!(
                    "poisoned rwlock(read) recovered at {}:{}:{}",
                    loc.file(),
                    loc.line(),
                    loc.column()
                );
                err.into_inner()
            }
        }
    }

    #[track_caller]
    fn write_unpoisoned(&self) -> RwLockWriteGuard<'_, T> {
        match self.write() {
            Ok(guard) => guard,
            Err(err) => {
                let loc = std::panic::Location::caller();
                eprintln!(
                    "poisoned rwlock(write) recovered at {}:{}:{}",
                    loc.file(),
                    loc.line(),
                    loc.column()
                );
                err.into_inner()
            }
        }
    }
}

pub trait CondvarExt {
    #[track_caller]
    fn wait_unpoisoned<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T>;

    #[track_caller]
    fn wait_timeout_unpoisoned<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        dur: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult);

    #[track_caller]
    fn wait_while_unpoisoned<'a, T, F>(
        &self,
        guard: MutexGuard<'a, T>,
        condition: F,
    ) -> MutexGuard<'a, T>
    where
        F: FnMut(&mut T) -> bool;
}

impl CondvarExt for Condvar {
    #[track_caller]
    fn wait_unpoisoned<'a, T>(&self, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T> {
        match self.wait(guard) {
            Ok(guard) => guard,
            Err(err) => {
                let loc = std::panic::Location::caller();
                eprintln!(
                    "poisoned condvar(wait) recovered at {}:{}:{}",
                    loc.file(),
                    loc.line(),
                    loc.column()
                );
                err.into_inner()
            }
        }
    }

    #[track_caller]
    fn wait_timeout_unpoisoned<'a, T>(
        &self,
        guard: MutexGuard<'a, T>,
        dur: Duration,
    ) -> (MutexGuard<'a, T>, WaitTimeoutResult) {
        match self.wait_timeout(guard, dur) {
            Ok(v) => v,
            Err(err) => {
                let loc = std::panic::Location::caller();
                eprintln!(
                    "poisoned condvar(wait_timeout) recovered at {}:{}:{}",
                    loc.file(),
                    loc.line(),
                    loc.column()
                );
                err.into_inner()
            }
        }
    }

    #[track_caller]
    fn wait_while_unpoisoned<'a, T, F>(
        &self,
        guard: MutexGuard<'a, T>,
        condition: F,
    ) -> MutexGuard<'a, T>
    where
        F: FnMut(&mut T) -> bool,
    {
        match self.wait_while(guard, condition) {
            Ok(guard) => guard,
            Err(err) => {
                let loc = std::panic::Location::caller();
                eprintln!(
                    "poisoned condvar(wait_while) recovered at {}:{}:{}",
                    loc.file(),
                    loc.line(),
                    loc.column()
                );
                err.into_inner()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Condvar, Mutex, RwLock};
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
        drop(guard);
    }

    #[test]
    #[allow(clippy::significant_drop_tightening)]
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
        drop(guard);
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
        let (guard, _timeout) =
            cv.wait_timeout_unpoisoned(lock.lock_unpoisoned(), Duration::from_millis(0));
        assert_eq!(*guard, 1);
    }
}
