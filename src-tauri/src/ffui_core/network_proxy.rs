use std::sync::atomic::{
    AtomicBool,
    Ordering,
};
use std::sync::{
    Mutex,
    RwLock,
};

use once_cell::sync::Lazy;

use crate::ffui_core::settings::{
    NetworkProxyMode,
    NetworkProxySettings,
};
use crate::sync_ext::{
    MutexExt,
    RwLockExt,
};

#[derive(Debug, Clone)]
struct NetworkProxyConfig {
    mode: NetworkProxyMode,
    custom_proxy_url: Option<String>,
}

static NETWORK_PROXY_CONFIG: Lazy<RwLock<NetworkProxyConfig>> = Lazy::new(|| {
    RwLock::new(NetworkProxyConfig {
        mode: NetworkProxyMode::System,
        custom_proxy_url: None,
    })
});

static UPDATER_PROXY_ENV_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static PROXY_ENV_MANAGED_BY_FFUI: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone)]
pub struct ResolvedNetworkProxy {
    mode: NetworkProxyMode,
    proxy_url: Option<String>,
}

impl ResolvedNetworkProxy {
    pub fn proxy_url(&self) -> Option<&str> {
        self.proxy_url.as_deref()
    }
}

pub fn apply_settings(settings: Option<&NetworkProxySettings>) {
    let mut state = NETWORK_PROXY_CONFIG.write_unpoisoned();
    let mode = settings.map(|s| s.mode).unwrap_or(NetworkProxyMode::System);
    let proxy_url = settings
        .and_then(|s| s.proxy_url.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    state.mode = mode;
    state.custom_proxy_url = proxy_url;
}

pub fn snapshot() -> (NetworkProxyMode, Option<String>) {
    let state = NETWORK_PROXY_CONFIG.read_unpoisoned();
    (state.mode, state.custom_proxy_url.clone())
}

pub fn resolve_effective_proxy_once() -> ResolvedNetworkProxy {
    let (mode, proxy_url) = snapshot();
    let proxy_url = match mode {
        NetworkProxyMode::None => None,
        NetworkProxyMode::Custom => proxy_url,
        NetworkProxyMode::System => proxy_from_env().or_else(proxy_from_platform_system_proxy),
    };
    ResolvedNetworkProxy { mode, proxy_url }
}

pub fn apply_reqwest_builder(
    builder: reqwest::ClientBuilder,
    resolved: &ResolvedNetworkProxy,
) -> reqwest::ClientBuilder {
    apply_reqwest_proxy_impl(
        builder,
        resolved,
        |builder| builder.no_proxy(),
        |builder, proxy| builder.proxy(proxy),
    )
}

pub fn apply_reqwest_blocking_builder(
    builder: reqwest::blocking::ClientBuilder,
    resolved: &ResolvedNetworkProxy,
) -> reqwest::blocking::ClientBuilder {
    apply_reqwest_proxy_impl(
        builder,
        resolved,
        |builder| builder.no_proxy(),
        |builder, proxy| builder.proxy(proxy),
    )
}

fn apply_reqwest_proxy_impl<T>(
    builder: T,
    resolved: &ResolvedNetworkProxy,
    no_proxy: impl Fn(T) -> T,
    with_proxy: impl Fn(T, reqwest::Proxy) -> T,
) -> T {
    #[cfg(test)]
    {
        let _ = (resolved, &with_proxy);
        // Unit tests should be deterministic and avoid inheriting platform/system
        // proxy configuration (common on Windows via WinHTTP/WinINet).
        no_proxy(builder)
    }

    #[cfg(not(test))]
    {
        let mut builder = builder;
        match resolved.mode {
            NetworkProxyMode::None => return no_proxy(builder),
            NetworkProxyMode::Custom | NetworkProxyMode::System => {
                if let Some(url) = resolved.proxy_url.as_deref()
                    && let Ok(proxy) = reqwest::Proxy::all(url)
                {
                    builder = with_proxy(builder, proxy);
                }
            }
        }
        builder
    }
}

pub fn apply_aria2c_args(cmd: &mut std::process::Command, resolved: &ResolvedNetworkProxy) {
    let mode = resolved.mode;
    let proxy_url = resolved.proxy_url.clone();
    match mode {
        NetworkProxyMode::None => {
            cmd.arg("--all-proxy=").arg("--no-proxy=*");
        }
        NetworkProxyMode::Custom => {
            if let Some(url) = proxy_url {
                cmd.arg("--all-proxy").arg(url);
            }
        }
        NetworkProxyMode::System => {
            if let Some(url) = proxy_url {
                cmd.arg("--all-proxy").arg(url);
            }
        }
    }
}

pub fn prepare_updater_proxy_env() -> ResolvedNetworkProxy {
    let _guard = UPDATER_PROXY_ENV_MUTEX.lock_unpoisoned();

    let resolved = resolve_effective_proxy_once();
    match resolved.mode {
        NetworkProxyMode::None => {
            for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                // SAFETY: We intentionally mutate process-wide env vars so the
                // updater plugin can pick up the desired proxy configuration.
                unsafe { std::env::remove_var(key) };
            }
            PROXY_ENV_MANAGED_BY_FFUI.store(true, Ordering::Relaxed);
        }
        NetworkProxyMode::Custom => {
            if let Some(url) = resolved.proxy_url.as_deref() {
                for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                    // SAFETY: see remove_var safety comment above.
                    unsafe { std::env::set_var(key, url) };
                }
            } else {
                for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                    unsafe { std::env::remove_var(key) };
                }
            }
            PROXY_ENV_MANAGED_BY_FFUI.store(true, Ordering::Relaxed);
        }
        NetworkProxyMode::System => {
            // If env already configures a proxy and FFUI is not managing proxy
            // env vars, keep it as-is (treat as user-supplied).
            if proxy_from_env().is_some() && !PROXY_ENV_MANAGED_BY_FFUI.load(Ordering::Relaxed) {
                return resolved;
            }

            if let Some(url) = resolved.proxy_url.as_deref() {
                for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                    // SAFETY: see remove_var safety comment above.
                    unsafe { std::env::set_var(key, url) };
                }
            } else {
                for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                    unsafe { std::env::remove_var(key) };
                }
            }
            PROXY_ENV_MANAGED_BY_FFUI.store(true, Ordering::Relaxed);
        }
    }

    resolved
}

fn proxy_from_env() -> Option<String> {
    // Avoid feeding proxy env vars that FFUI set for the updater plugin back
    // into our own System proxy resolution. Only treat env as an override when
    // it is user-supplied.
    if PROXY_ENV_MANAGED_BY_FFUI.load(Ordering::Relaxed) {
        return None;
    }
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(v) = std::env::var(key) {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn proxy_from_platform_system_proxy() -> Option<String> {
    #[cfg(test)]
    if let Some(hook) = TEST_PLATFORM_PROXY_HOOK.with(|slot| slot.borrow().clone()) {
        return hook();
    }

    proxy_from_windows_inet_settings()
}

#[cfg(not(windows))]
fn proxy_from_windows_inet_settings() -> Option<String> {
    None
}

#[cfg(windows)]
fn proxy_from_windows_inet_settings() -> Option<String> {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER,
        RRF_RT_REG_DWORD,
        RRF_RT_REG_EXPAND_SZ,
        RRF_RT_REG_SZ,
        RegGetValueW,
    };
    use windows::core::{
        HSTRING,
        PCWSTR,
    };

    const SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    fn read_reg_dword(subkey: &HSTRING, name: &HSTRING) -> Option<u32> {
        let mut value: u32 = 0;
        let mut size: u32 = std::mem::size_of::<u32>() as u32;
        // SAFETY: `value` is a valid buffer of `size` bytes.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                PCWSTR(name.as_ptr()),
                RRF_RT_REG_DWORD,
                None,
                Some((&mut value as *mut u32).cast()),
                Some(&mut size),
            )
        };
        if status == ERROR_SUCCESS {
            Some(value)
        } else {
            None
        }
    }

    fn read_reg_string(subkey: &HSTRING, name: &HSTRING) -> Option<String> {
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
        let mut size: u32 = 0;
        // SAFETY: first call queries required buffer size.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                PCWSTR(name.as_ptr()),
                flags,
                None,
                None,
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS || size < 2 {
            return None;
        }

        let mut buf: Vec<u16> = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: `buf` is a valid writable buffer of `size` bytes (or larger).
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                PCWSTR(name.as_ptr()),
                flags,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }

        // `size` is bytes. Convert to u16 length, trim trailing NUL.
        let mut len = (size as usize) / 2;
        if len > buf.len() {
            len = buf.len();
        }
        while len > 0 && buf[len - 1] == 0 {
            len -= 1;
        }
        if len == 0 {
            return None;
        }
        String::from_utf16(&buf[..len]).ok()
    }

    let subkey = HSTRING::from(SUBKEY);
    let enabled_name = HSTRING::from("ProxyEnable");
    let server_name = HSTRING::from("ProxyServer");

    let enabled = read_reg_dword(&subkey, &enabled_name);
    if enabled != Some(1) {
        return None;
    }

    let server = read_reg_string(&subkey, &server_name)?;
    let trimmed = server.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Formats:
    // - host:port
    // - http=host:port;https=host:port
    let mut pick: Option<&str> = None;
    for part in trimmed.split(';') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        if let Some(rest) = p.strip_prefix("https=") {
            pick = Some(rest);
            break;
        }
        if let Some(rest) = p.strip_prefix("http=") {
            pick = Some(rest);
        }
    }
    let host_port = pick.unwrap_or(trimmed).trim();
    if host_port.is_empty() {
        return None;
    }
    if host_port.starts_with("http://") || host_port.starts_with("https://") {
        Some(host_port.to_string())
    } else {
        Some(format!("http://{host_port}"))
    }
}

#[cfg(test)]
type PlatformProxyHook = std::sync::Arc<dyn Fn() -> Option<String> + Send + Sync + 'static>;

#[cfg(test)]
thread_local! {
    static TEST_PLATFORM_PROXY_HOOK: std::cell::RefCell<Option<PlatformProxyHook>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) struct TestPlatformProxyHookGuard {
    prev: Option<PlatformProxyHook>,
}

#[cfg(test)]
impl Drop for TestPlatformProxyHookGuard {
    fn drop(&mut self) {
        let prev = self.prev.take();
        TEST_PLATFORM_PROXY_HOOK.with(|slot| {
            *slot.borrow_mut() = prev;
        });
    }
}

#[cfg(test)]
pub(crate) fn install_test_platform_proxy_hook(
    hook: PlatformProxyHook,
) -> TestPlatformProxyHookGuard {
    let prev = TEST_PLATFORM_PROXY_HOOK.with(|slot| slot.borrow_mut().replace(hook));
    TestPlatformProxyHookGuard { prev }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{
        AtomicUsize,
        Ordering,
    };

    use super::*;

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
    fn resolve_system_calls_platform_proxy_reader_when_env_missing() {
        let _lock = ENV_MUTEX.lock_unpoisoned();
        let _env_guard = ProxyEnvGuard::capture();
        clear_proxy_env();
        apply_settings(Some(&NetworkProxySettings {
            mode: NetworkProxyMode::System,
            proxy_url: None,
        }));

        let calls = std::sync::Arc::new(AtomicUsize::new(0));
        let calls_clone = calls.clone();
        let _hook_guard = install_test_platform_proxy_hook(std::sync::Arc::new(move || {
            calls_clone.fetch_add(1, Ordering::SeqCst);
            Some("http://127.0.0.1:7890".to_string())
        }));

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
        let args = cmd
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
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
        let args = cmd
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(args.iter().any(|a| a == "--all-proxy="));
        assert!(args.iter().any(|a| a == "--no-proxy=*"));
    }
}
