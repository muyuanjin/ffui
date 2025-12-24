use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use once_cell::sync::Lazy;

use super::*;
use crate::sync_ext::MutexExt;

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

fn apply_system_proxy_settings() {
    apply_settings(Some(&NetworkProxySettings {
        mode: NetworkProxyMode::System,
        proxy_url: None,
    }));
}

fn install_counting_platform_proxy_hook(
    url: &str,
) -> (std::sync::Arc<AtomicUsize>, TestPlatformProxyHookGuard) {
    let url = url.to_string();
    let calls = std::sync::Arc::new(AtomicUsize::new(0));
    let calls_clone = calls.clone();
    let hook_guard = install_test_platform_proxy_hook(std::sync::Arc::new(move || {
        calls_clone.fetch_add(1, Ordering::SeqCst);
        Some(url.clone())
    }));
    (calls, hook_guard)
}

#[test]
fn resolve_system_calls_platform_proxy_reader_when_env_missing() {
    let _lock = ENV_MUTEX.lock_unpoisoned();
    let _env_guard = ProxyEnvGuard::capture();
    clear_proxy_env();
    apply_system_proxy_settings();
    let (calls, _hook_guard) = install_counting_platform_proxy_hook("http://127.0.0.1:7890");

    let resolved = resolve_effective_proxy_once();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(resolved.proxy_url(), Some("http://127.0.0.1:7890"));
}

#[test]
fn aria2c_args_use_resolved_proxy_snapshot() {
    let _lock = ENV_MUTEX.lock_unpoisoned();
    let _env_guard = ProxyEnvGuard::capture();
    clear_proxy_env();

    apply_settings(Some(&NetworkProxySettings {
        mode: NetworkProxyMode::Custom,
        proxy_url: Some("http://127.0.0.1:7890".to_string()),
    }));
    let resolved = resolve_effective_proxy_once();
    let mut cmd = std::process::Command::new("aria2c");
    apply_aria2c_args(&mut cmd, &resolved);
    let args = cmd_args(&cmd);
    assert!(
        args.windows(2)
            .any(|w| w[0] == "--all-proxy" && w[1] == "http://127.0.0.1:7890")
    );

    apply_settings(Some(&NetworkProxySettings {
        mode: NetworkProxyMode::None,
        proxy_url: None,
    }));
    let resolved = resolve_effective_proxy_once();
    let mut cmd = std::process::Command::new("aria2c");
    apply_aria2c_args(&mut cmd, &resolved);
    let args = cmd_args(&cmd);
    assert!(args.iter().any(|a| a == "--all-proxy="));
    assert!(args.iter().any(|a| a == "--no-proxy=*"));
}

#[test]
fn updater_proxy_override_skips_when_env_proxy_present() {
    let _lock = ENV_MUTEX.lock_unpoisoned();
    let _env_guard = ProxyEnvGuard::capture();
    clear_proxy_env();
    unsafe { std::env::set_var("HTTPS_PROXY", "http://env.example:7890") };

    apply_system_proxy_settings();
    let (calls, _hook_guard) = install_counting_platform_proxy_hook("http://127.0.0.1:7890");

    let override_proxy = resolve_updater_proxy_override_once();
    assert_eq!(override_proxy, None);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn updater_proxy_override_uses_platform_proxy_when_env_missing() {
    let _lock = ENV_MUTEX.lock_unpoisoned();
    let _env_guard = ProxyEnvGuard::capture();
    clear_proxy_env();

    apply_system_proxy_settings();
    let (calls, _hook_guard) = install_counting_platform_proxy_hook("http://127.0.0.1:7890");

    let override_proxy = resolve_updater_proxy_override_once();
    assert_eq!(override_proxy.as_deref(), Some("http://127.0.0.1:7890"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

fn cmd_args(cmd: &std::process::Command) -> Vec<String> {
    cmd.get_args()
        .map(|s| s.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
}
