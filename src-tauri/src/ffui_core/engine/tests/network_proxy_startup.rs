use crate::ffui_core::engine::TranscodingEngine;
use crate::ffui_core::network_proxy;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

static ENV_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

struct ProxyEnvGuard {
    prev: Vec<(String, Option<String>)>,
}

impl ProxyEnvGuard {
    fn capture() -> Self {
        let keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
        let prev = keys
            .into_iter()
            .map(|k| (k.to_string(), std::env::var(k).ok()))
            .collect::<Vec<_>>();
        Self { prev }
    }
}

impl Drop for ProxyEnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.prev.drain(..) {
            match value {
                Some(v) => unsafe { std::env::set_var(key, v) },
                None => unsafe { std::env::remove_var(key) },
            }
        }
    }
}

fn clear_proxy_env() {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        unsafe { std::env::remove_var(key) };
    }
}

#[test]
fn engine_new_does_not_resolve_system_proxy_on_startup_path() {
    let _lock = ENV_MUTEX.lock().expect("ENV_MUTEX lock poisoned");
    let _env_guard = ProxyEnvGuard::capture();
    clear_proxy_env();

    let calls = Arc::new(AtomicUsize::new(0));
    let calls_clone = calls.clone();
    let _hook_guard = network_proxy::install_test_platform_proxy_hook(Arc::new(move || {
        calls_clone.fetch_add(1, Ordering::SeqCst);
        None
    }));

    let _engine = TranscodingEngine::new().expect("engine should start");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "engine startup must not trigger system proxy discovery"
    );
}
