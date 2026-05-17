use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;

use crate::ffui_core::tools::types::{FFMPEG_STATIC_TAG, FFMPEG_STATIC_VERSION, LIBAVIF_VERSION};
use crate::sync_ext::MutexExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReleaseResolveSource {
    Api,
    Redirect,
    Html,
    Atom,
    Pinned,
}

impl ReleaseResolveSource {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Api => "api",
            Self::Redirect => "redirect",
            Self::Html => "html",
            Self::Atom => "atom",
            Self::Pinned => "pinned",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ReleaseResolveInfo {
    pub(crate) version: String,
    pub(crate) tag: String,
    pub(crate) source: ReleaseResolveSource,
    pub(crate) warning: Option<String>,
    pub(crate) rate_limit_reset_ms: Option<u64>,
}

impl ReleaseResolveInfo {
    pub(crate) fn cacheable(&self) -> bool {
        self.source != ReleaseResolveSource::Pinned
    }

    pub(crate) fn status_message(&self) -> Option<String> {
        let mut parts = vec![format!(
            "remote version check source: {}",
            self.source.as_str()
        )];
        if let Some(reset_ms) = self.rate_limit_reset_ms {
            parts.push(format!("GitHub API rate limit resetAtMs={reset_ms}"));
        }
        if let Some(warning) = self.warning.as_deref()
            && !warning.trim().is_empty()
        {
            parts.push(warning.trim().to_string());
        }
        Some(parts.join("; "))
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct GithubReleaseProject {
    pub(super) owner: &'static str,
    pub(super) repo: &'static str,
    pub(super) api_url: &'static str,
    pub(super) latest_url: &'static str,
    pub(super) releases_url: &'static str,
    pub(super) atom_url: &'static str,
    #[cfg(not(test))]
    pub(super) user_agent: &'static str,
    pub(super) pinned_tag: &'static str,
    pub(super) pinned_version: &'static str,
    rate_limit_key: &'static str,
}

pub(super) const FFMPEG_PROJECT: GithubReleaseProject = GithubReleaseProject {
    owner: "eugeneware",
    repo: "ffmpeg-static",
    api_url: "https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest",
    latest_url: "https://github.com/eugeneware/ffmpeg-static/releases/latest",
    releases_url: "https://github.com/eugeneware/ffmpeg-static/releases",
    atom_url: "https://github.com/eugeneware/ffmpeg-static/releases.atom",
    #[cfg(not(test))]
    user_agent: "ffui/ffmpeg-static-updater",
    pinned_tag: FFMPEG_STATIC_TAG,
    pinned_version: FFMPEG_STATIC_VERSION,
    rate_limit_key: "eugeneware/ffmpeg-static",
};

pub(super) const LIBAVIF_PROJECT: GithubReleaseProject = GithubReleaseProject {
    owner: "AOMediaCodec",
    repo: "libavif",
    api_url: "https://api.github.com/repos/AOMediaCodec/libavif/releases/latest",
    latest_url: "https://github.com/AOMediaCodec/libavif/releases/latest",
    releases_url: "https://github.com/AOMediaCodec/libavif/releases",
    atom_url: "https://github.com/AOMediaCodec/libavif/releases.atom",
    #[cfg(not(test))]
    user_agent: "ffui/libavif-updater",
    pinned_tag: LIBAVIF_VERSION,
    pinned_version: LIBAVIF_VERSION,
    rate_limit_key: "AOMediaCodec/libavif",
};

#[derive(Debug, Clone)]
pub(super) struct GithubHttpResponse {
    pub(super) status: u16,
    pub(super) final_url: String,
    pub(super) headers: Vec<(String, String)>,
    pub(super) body: String,
}

impl GithubHttpResponse {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

pub(super) trait GithubReleaseHttp {
    fn get(&mut self, url: &str) -> Result<GithubHttpResponse>;
}

static GITHUB_API_RATE_LIMIT_RESETS_MS: Lazy<Mutex<HashMap<&'static str, u64>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static SAFE_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").expect("tag regex"));

pub(crate) fn semantic_version_from_tag(tag: &str) -> String {
    let idx = tag.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    tag[idx..].to_string()
}

fn validate_release_tag(tag: &str) -> Option<String> {
    let trimmed = tag.trim();
    SAFE_TAG_RE.is_match(trimmed).then(|| trimmed.to_string())
}

fn make_info(
    tag: String,
    source: ReleaseResolveSource,
    warning: Option<String>,
    rate_limit_reset_ms: Option<u64>,
) -> ReleaseResolveInfo {
    ReleaseResolveInfo {
        version: semantic_version_from_tag(&tag),
        tag,
        source,
        warning,
        rate_limit_reset_ms,
    }
}

pub(super) fn pinned_info(
    project: GithubReleaseProject,
    warning: Option<String>,
    rate_limit_reset_ms: Option<u64>,
) -> ReleaseResolveInfo {
    ReleaseResolveInfo {
        version: project.pinned_version.to_string(),
        tag: project.pinned_tag.to_string(),
        source: ReleaseResolveSource::Pinned,
        warning,
        rate_limit_reset_ms,
    }
}

fn rate_limit_reset_ms(resp: &GithubHttpResponse) -> Option<u64> {
    let reset_seconds = resp
        .header("x-ratelimit-reset")?
        .trim()
        .parse::<u64>()
        .ok()?;
    reset_seconds.checked_mul(1000)
}

fn api_rate_limit_reset_for(project: GithubReleaseProject, now_ms: u64) -> Option<u64> {
    let resets = GITHUB_API_RATE_LIMIT_RESETS_MS.lock_unpoisoned();
    resets
        .get(project.rate_limit_key)
        .copied()
        .filter(|reset_ms| *reset_ms > now_ms)
}

fn record_api_rate_limit_reset(project: GithubReleaseProject, reset_ms: u64) {
    let mut resets = GITHUB_API_RATE_LIMIT_RESETS_MS.lock_unpoisoned();
    resets.insert(project.rate_limit_key, reset_ms);
}

#[cfg(test)]
pub(super) fn reset_rate_limit_state_for_tests() {
    GITHUB_API_RATE_LIMIT_RESETS_MS.lock_unpoisoned().clear();
}

fn parse_api_tag(body: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Release {
        tag_name: String,
    }

    let release: Release = serde_json::from_str(body).ok()?;
    validate_release_tag(&release.tag_name)
}

fn tag_regex_for(project: GithubReleaseProject) -> Regex {
    Regex::new(&format!(
        r#"/{}/{}/releases/tag/([^/?#"'<>[:space:]]+)"#,
        regex::escape(project.owner),
        regex::escape(project.repo)
    ))
    .expect("release tag URL regex")
}

fn extract_tag_from_release_url(project: GithubReleaseProject, input: &str) -> Option<String> {
    let caps = tag_regex_for(project).captures(input)?;
    validate_release_tag(caps.get(1)?.as_str())
}

fn extract_tag_from_atom(project: GithubReleaseProject, atom: &str) -> Option<String> {
    static ENTRY_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?is)<entry\b.*?</entry>").expect("atom entry regex"));

    if let Some(entry) = ENTRY_RE.find(atom)
        && let Some(tag) = extract_tag_from_release_url(project, entry.as_str())
    {
        return Some(tag);
    }
    extract_tag_from_release_url(project, atom)
}

pub(super) fn merge_warning(existing: Option<String>, next: impl Into<String>) -> Option<String> {
    let next = next.into();
    if next.trim().is_empty() {
        return existing;
    }
    match existing {
        Some(existing) if !existing.trim().is_empty() => Some(format!("{existing}; {next}")),
        _ => Some(next),
    }
}

pub(super) fn resolve_github_release_with_http(
    project: GithubReleaseProject,
    http: &mut impl GithubReleaseHttp,
    now_ms: u64,
) -> ReleaseResolveInfo {
    let mut warning: Option<String> = None;
    let mut rate_limit_reset = api_rate_limit_reset_for(project, now_ms);

    if let Some(reset_ms) = rate_limit_reset {
        warning = merge_warning(
            warning,
            format!(
                "GitHub API rate limit reset is pending; skipped API and tried non-API release check (resetAtMs={reset_ms})"
            ),
        );
    } else {
        match http.get(project.api_url) {
            Ok(resp) if resp.success() => {
                if let Some(tag) = parse_api_tag(&resp.body) {
                    return make_info(tag, ReleaseResolveSource::Api, warning, None);
                }
                warning = merge_warning(
                    warning,
                    "GitHub API returned malformed release metadata; tried non-API release check",
                );
            }
            Ok(resp) if resp.status == 403 && resp.header("x-ratelimit-remaining") == Some("0") => {
                rate_limit_reset = rate_limit_reset_ms(&resp);
                if let Some(reset_ms) = rate_limit_reset {
                    record_api_rate_limit_reset(project, reset_ms);
                }
                warning = merge_warning(
                    warning,
                    "GitHub API rate limit exhausted; tried non-API release check",
                );
            }
            Ok(resp) if resp.status == 403 => {
                warning = merge_warning(
                    warning,
                    "GitHub API rejected the request; tried non-API release check",
                );
            }
            Ok(resp) => {
                warning = merge_warning(
                    warning,
                    format!(
                        "GitHub API request failed with status {}; tried non-API release check",
                        resp.status
                    ),
                );
            }
            Err(err) => {
                warning = merge_warning(
                    warning,
                    format!("GitHub API request failed; tried non-API release check: {err:#}"),
                );
            }
        }
    }

    match http.get(project.latest_url) {
        Ok(resp) => {
            if let Some(tag) = extract_tag_from_release_url(project, &resp.final_url) {
                return make_info(
                    tag,
                    ReleaseResolveSource::Redirect,
                    warning,
                    rate_limit_reset,
                );
            }
            if let Some(location) = resp.header("location")
                && let Some(tag) = extract_tag_from_release_url(project, location)
            {
                return make_info(
                    tag,
                    ReleaseResolveSource::Redirect,
                    warning,
                    rate_limit_reset,
                );
            }
        }
        Err(err) => {
            warning = merge_warning(warning, format!("GitHub latest redirect failed: {err:#}"));
        }
    }

    match http.get(project.releases_url) {
        Ok(resp) if resp.success() => {
            if let Some(tag) = extract_tag_from_release_url(project, &resp.body) {
                return make_info(tag, ReleaseResolveSource::Html, warning, rate_limit_reset);
            }
        }
        Ok(resp) => {
            warning = merge_warning(
                warning,
                format!("GitHub releases page failed with status {}", resp.status),
            );
        }
        Err(err) => {
            warning = merge_warning(warning, format!("GitHub releases page failed: {err:#}"));
        }
    }

    match http.get(project.atom_url) {
        Ok(resp) if resp.success() => {
            if let Some(tag) = extract_tag_from_atom(project, &resp.body) {
                return make_info(tag, ReleaseResolveSource::Atom, warning, rate_limit_reset);
            }
        }
        Ok(resp) => {
            warning = merge_warning(
                warning,
                format!("GitHub releases feed failed with status {}", resp.status),
            );
        }
        Err(err) => {
            warning = merge_warning(warning, format!("GitHub releases feed failed: {err:#}"));
        }
    }

    pinned_info(
        project,
        merge_warning(
            warning,
            "all remote release checks failed; using the built-in pinned version",
        ),
        rate_limit_reset,
    )
}
