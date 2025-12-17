use std::sync::RwLock;

use once_cell::sync::Lazy;

use crate::ffui_core::settings::{NetworkProxyMode, NetworkProxySettings};

#[derive(Debug, Clone)]
struct NetworkProxyRuntime {
    mode: NetworkProxyMode,
    proxy_url: Option<String>,
}

static NETWORK_PROXY: Lazy<RwLock<NetworkProxyRuntime>> = Lazy::new(|| {
    RwLock::new(NetworkProxyRuntime {
        mode: NetworkProxyMode::System,
        proxy_url: None,
    })
});

pub fn apply_settings(settings: Option<&NetworkProxySettings>) {
    let mut state = NETWORK_PROXY.write().expect("NETWORK_PROXY lock poisoned");
    let mode = settings.map(|s| s.mode).unwrap_or(NetworkProxyMode::System);
    let proxy_url = settings
        .and_then(|s| s.proxy_url.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    state.mode = mode;
    state.proxy_url = proxy_url;
    drop(state);
    apply_proxy_env_overrides();
}

pub fn snapshot() -> (NetworkProxyMode, Option<String>) {
    let state = NETWORK_PROXY.read().expect("NETWORK_PROXY lock poisoned");
    (state.mode, state.proxy_url.clone())
}

pub fn resolved_proxy_url_for_network() -> Option<String> {
    let (mode, proxy_url) = snapshot();
    match mode {
        NetworkProxyMode::None => None,
        NetworkProxyMode::Custom => proxy_url,
        NetworkProxyMode::System => proxy_from_env().or_else(proxy_from_windows_inet_settings),
    }
}

pub fn apply_reqwest_builder(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    #[cfg(test)]
    {
        // Unit tests should be deterministic and avoid inheriting platform/system
        // proxy configuration (common on Windows via WinHTTP/WinINet).
        return builder.no_proxy();
    }

    #[cfg(not(test))]
    let (mode, proxy_url) = snapshot();
    #[cfg(not(test))]
    match mode {
        NetworkProxyMode::None => builder.no_proxy(),
        NetworkProxyMode::Custom => {
            if let Some(url) = proxy_url
                && let Ok(proxy) = reqwest::Proxy::all(&url)
            {
                builder.proxy(proxy)
            } else {
                builder
            }
        }
        NetworkProxyMode::System => {
            if let Some(url) = proxy_from_env().or_else(proxy_from_windows_inet_settings)
                && let Ok(proxy) = reqwest::Proxy::all(&url)
            {
                builder.proxy(proxy)
            } else {
                builder
            }
        }
    }
}

pub fn apply_aria2c_args(cmd: &mut std::process::Command) {
    let (mode, proxy_url) = snapshot();
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
            if let Some(url) = resolved_proxy_url_for_network() {
                cmd.arg("--all-proxy").arg(url);
            }
        }
    }
}

fn apply_proxy_env_overrides() {
    let (mode, proxy_url) = snapshot();
    match mode {
        NetworkProxyMode::None => {
            for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                // SAFETY: We intentionally mutate process-wide env vars to steer
                // proxy behavior for components that don't accept explicit
                // proxy settings (e.g. updater plugin). This is best-effort and
                // scoped to this application process.
                unsafe { std::env::remove_var(key) };
            }
        }
        NetworkProxyMode::Custom => {
            if let Some(url) = proxy_url {
                for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                    // SAFETY: see remove_var safety comment above.
                    unsafe { std::env::set_var(key, &url) };
                }
            }
        }
        NetworkProxyMode::System => {
            // If env already configures a proxy, keep it as-is.
            if proxy_from_env().is_some() {
                return;
            }
            // Best-effort: on Windows, surface WinINet proxy to env so 3rd-party
            // components (e.g. updater plugin) can inherit it.
            if let Some(url) = proxy_from_windows_inet_settings() {
                for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
                    // SAFETY: see remove_var safety comment above.
                    unsafe { std::env::set_var(key, &url) };
                }
            }
        }
    }
}

fn proxy_from_env() -> Option<String> {
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

#[cfg(not(windows))]
fn proxy_from_windows_inet_settings() -> Option<String> {
    None
}

#[cfg(windows)]
fn proxy_from_windows_inet_settings() -> Option<String> {
    use std::process::Command;

    // Avoid visible console windows when spawning helper commands on Windows.
    fn configure_background_command(cmd: &mut Command) {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    fn query_value(name: &str) -> Option<String> {
        let mut cmd = Command::new("reg");
        configure_background_command(&mut cmd);
        let output = cmd
            .arg("query")
            .arg(r#"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"#)
            .arg("/v")
            .arg(name)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Example:
            // ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7890
            if !trimmed.to_ascii_lowercase().starts_with(&name.to_ascii_lowercase()) {
                continue;
            }
            if let Some(idx) = trimmed.find("REG_") {
                let after = trimmed[idx..].split_whitespace().skip(2).collect::<Vec<_>>().join(" ");
                let value = after.trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
        None
    }

    let enabled = query_value("ProxyEnable").and_then(|raw| {
        // REG_DWORD 0x1
        let token = raw.split_whitespace().last().unwrap_or("").trim();
        if token.starts_with("0x") {
            u32::from_str_radix(token.trim_start_matches("0x"), 16).ok()
        } else {
            token.parse::<u32>().ok()
        }
    });
    if enabled != Some(1) {
        return None;
    }

    let server = query_value("ProxyServer")?;
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
