#![cfg(not(test))]

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};

use super::release_resolver::{
    FFMPEG_PROJECT, GithubHttpResponse, GithubReleaseHttp, GithubReleaseProject, LIBAVIF_PROJECT,
    ReleaseResolveInfo, ReleaseResolveSource, merge_warning, pinned_info,
    resolve_github_release_with_http,
};
use crate::ffui_core::network_proxy;

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn build_client(
    user_agent: &str,
    timeout: std::time::Duration,
    proxy: Option<reqwest::Proxy>,
    force_no_proxy: bool,
) -> Result<reqwest::blocking::Client> {
    use reqwest::blocking::Client;

    let mut builder = Client::builder().timeout(timeout).user_agent(user_agent);
    if force_no_proxy {
        builder = builder.no_proxy();
    }
    if let Some(proxy) = proxy {
        builder = builder.proxy(proxy);
    }
    builder.build().context("failed to build HTTP client")
}

struct ReqwestGithubReleaseHttp {
    client: reqwest::blocking::Client,
}

impl GithubReleaseHttp for ReqwestGithubReleaseHttp {
    fn get(&mut self, url: &str) -> Result<GithubHttpResponse> {
        let resp = self.client.get(url).send().context("request failed")?;
        let status = resp.status().as_u16();
        let final_url = resp.url().to_string();
        let headers = resp
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                Some((name.as_str().to_string(), value.to_str().ok()?.to_string()))
            })
            .collect();
        let body = resp.text().context("failed to read response body")?;
        Ok(GithubHttpResponse {
            status,
            final_url,
            headers,
            body,
        })
    }
}

fn resolve_release_with_client(
    project: GithubReleaseProject,
    client: reqwest::blocking::Client,
) -> ReleaseResolveInfo {
    let mut http = ReqwestGithubReleaseHttp { client };
    resolve_github_release_with_http(project, &mut http, now_epoch_ms())
}

pub(super) fn resolve_release_from_github_checked(
    project: GithubReleaseProject,
) -> Result<ReleaseResolveInfo> {
    use std::time::Duration;

    let resolved = network_proxy::resolve_effective_proxy_once();
    let force_no_proxy = resolved.is_no_proxy_mode();

    let parsed = match network_proxy::parse_reqwest_proxy_for(&resolved) {
        Ok(v) => v,
        Err(err) => {
            if resolved.fallback_to_direct_on_error() {
                let client = build_client(project.user_agent, Duration::from_secs(5), None, true)?;
                let mut info = resolve_release_with_client(project, client);
                info.warning = merge_warning(
                    Some(format!(
                        "[proxy] invalid proxy URL; falling back to direct: {err:#}"
                    )),
                    info.warning.unwrap_or_default(),
                );
                return Ok(info);
            }
            return Err(err);
        }
    };

    if let Some(parsed) = parsed {
        let proxy_client = build_client(
            project.user_agent,
            Duration::from_secs(5),
            Some(parsed.proxy),
            false,
        )?;
        let proxied = resolve_release_with_client(project, proxy_client);
        if proxied.source != ReleaseResolveSource::Pinned || !resolved.fallback_to_direct_on_error()
        {
            return Ok(proxied);
        }
        let direct = build_client(project.user_agent, Duration::from_secs(5), None, true)?;
        let mut direct_info = resolve_release_with_client(project, direct);
        direct_info.warning = merge_warning(
            Some(format!(
                "[proxy] proxied release check failed; falling back to direct: {}",
                proxied
                    .warning
                    .as_deref()
                    .unwrap_or("all proxied release checks failed")
            )),
            direct_info.warning.unwrap_or_default(),
        );
        return Ok(direct_info);
    }

    let client = build_client(
        project.user_agent,
        Duration::from_secs(5),
        None,
        force_no_proxy,
    )?;
    Ok(resolve_release_with_client(project, client))
}

pub(super) fn resolve_ffmpeg_release_from_github() -> ReleaseResolveInfo {
    resolve_release_from_github_checked(FFMPEG_PROJECT)
        .unwrap_or_else(|err| pinned_info(FFMPEG_PROJECT, Some(format!("{err:#}")), None))
}

pub(super) fn resolve_libavif_release_from_github() -> ReleaseResolveInfo {
    resolve_release_from_github_checked(LIBAVIF_PROJECT)
        .unwrap_or_else(|err| pinned_info(LIBAVIF_PROJECT, Some(format!("{err:#}")), None))
}
