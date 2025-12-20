use std::ffi::{
    OsStr,
    OsString,
};
use std::sync::{
    Mutex,
    MutexGuard,
};

use once_cell::sync::Lazy;

static ENV_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub fn env_lock() -> MutexGuard<'static, ()> {
    ENV_MUTEX.lock().unwrap_or_else(|err| err.into_inner())
}

pub fn set_env<K: AsRef<OsStr>, V: AsRef<OsStr>>(key: K, value: V) {
    unsafe { std::env::set_var(key, value) }
}

pub fn remove_env<K: AsRef<OsStr>>(key: K) {
    unsafe { std::env::remove_var(key) }
}

pub struct EnvVarGuard {
    prev: Vec<(String, Option<OsString>)>,
}

impl EnvVarGuard {
    pub fn capture<I, S>(keys: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>, {
        let prev = keys
            .into_iter()
            .map(|k| {
                let key = k.as_ref().to_string();
                let value = std::env::var_os(&key);
                (key, value)
            })
            .collect();

        Self { prev }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        for (key, value) in self.prev.drain(..) {
            match value {
                Some(v) => set_env(&key, v),
                None => remove_env(&key),
            }
        }
    }
}
