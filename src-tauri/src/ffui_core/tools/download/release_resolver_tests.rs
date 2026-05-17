use std::collections::VecDeque;

use anyhow::{Result, anyhow};

use super::release_resolver::{
    FFMPEG_PROJECT, GithubHttpResponse, GithubReleaseHttp, LIBAVIF_PROJECT, ReleaseResolveSource,
    reset_rate_limit_state_for_tests, resolve_github_release_with_http,
};
use crate::ffui_core::tools::types::{
    FFMPEG_RELEASE_CACHE, FFMPEG_STATIC_TAG, FFMPEG_STATIC_VERSION, LIBAVIF_RELEASE_CACHE,
};
use crate::sync_ext::MutexExt;

struct MockHttp {
    responses: VecDeque<Result<GithubHttpResponse>>,
    urls: Vec<String>,
}

impl MockHttp {
    fn new(responses: Vec<Result<GithubHttpResponse>>) -> Self {
        Self {
            responses: responses.into(),
            urls: Vec::new(),
        }
    }
}

impl GithubReleaseHttp for MockHttp {
    fn get(&mut self, url: &str) -> Result<GithubHttpResponse> {
        self.urls.push(url.to_string());
        self.responses
            .pop_front()
            .unwrap_or_else(|| Err(anyhow!("unexpected request: {url}")))
    }
}

fn resp(status: u16, final_url: &str, headers: &[(&str, &str)], body: &str) -> GithubHttpResponse {
    GithubHttpResponse {
        status,
        final_url: final_url.to_string(),
        headers: headers
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect(),
        body: body.to_string(),
    }
}

fn reset_test_state() {
    reset_rate_limit_state_for_tests();
    *FFMPEG_RELEASE_CACHE.lock_unpoisoned() = None;
    *LIBAVIF_RELEASE_CACHE.lock_unpoisoned() = None;
}

#[test]
fn resolver_uses_api_success_without_fallback() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut http = MockHttp::new(vec![Ok(resp(
        200,
        FFMPEG_PROJECT.api_url,
        &[],
        r#"{"tag_name":"b7.0.0"}"#,
    ))]);

    let info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut http, 1_000);

    assert_eq!(info.source, ReleaseResolveSource::Api);
    assert_eq!(info.tag, "b7.0.0");
    assert_eq!(info.version, "7.0.0");
    assert_eq!(http.urls, vec![FFMPEG_PROJECT.api_url]);
}

#[test]
fn resolver_records_api_rate_limit_and_skips_api_until_reset() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut first = MockHttp::new(vec![
        Ok(resp(
            403,
            FFMPEG_PROJECT.api_url,
            &[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "3")],
            "",
        )),
        Ok(resp(
            200,
            "https://github.com/eugeneware/ffmpeg-static/releases/tag/b7.1.0",
            &[],
            "",
        )),
    ]);

    let first_info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut first, 1_000);

    assert_eq!(first_info.source, ReleaseResolveSource::Redirect);
    assert_eq!(first_info.tag, "b7.1.0");
    assert_eq!(first_info.rate_limit_reset_ms, Some(3_000));
    assert_eq!(
        first.urls,
        vec![FFMPEG_PROJECT.api_url, FFMPEG_PROJECT.latest_url]
    );

    let mut second = MockHttp::new(vec![Ok(resp(
        200,
        "https://github.com/eugeneware/ffmpeg-static/releases/tag/b7.2.0",
        &[],
        "",
    ))]);

    let second_info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut second, 2_000);

    assert_eq!(second_info.source, ReleaseResolveSource::Redirect);
    assert_eq!(second_info.tag, "b7.2.0");
    assert_eq!(second.urls, vec![FFMPEG_PROJECT.latest_url]);
}

#[test]
fn resolver_falls_back_after_non_rate_limit_403() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut http = MockHttp::new(vec![
        Ok(resp(403, FFMPEG_PROJECT.api_url, &[], "")),
        Ok(resp(
            200,
            "https://github.com/eugeneware/ffmpeg-static/releases/tag/b7.3.0",
            &[],
            "",
        )),
    ]);

    let info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut http, 1_000);

    assert_eq!(info.source, ReleaseResolveSource::Redirect);
    assert_eq!(info.tag, "b7.3.0");
    assert!(
        info.warning
            .as_deref()
            .is_some_and(|warning| warning.contains("rejected"))
    );
}

#[test]
fn resolver_extracts_tag_from_latest_redirect_location() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut http = MockHttp::new(vec![
        Ok(resp(500, FFMPEG_PROJECT.api_url, &[], "")),
        Ok(resp(
            302,
            FFMPEG_PROJECT.latest_url,
            &[(
                "location",
                "https://github.com/eugeneware/ffmpeg-static/releases/tag/b7.4.0",
            )],
            "",
        )),
    ]);

    let info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut http, 1_000);

    assert_eq!(info.source, ReleaseResolveSource::Redirect);
    assert_eq!(info.tag, "b7.4.0");
}

#[test]
fn resolver_uses_releases_html_after_redirect_failure() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut http = MockHttp::new(vec![
        Ok(resp(500, FFMPEG_PROJECT.api_url, &[], "")),
        Ok(resp(200, FFMPEG_PROJECT.latest_url, &[], "")),
        Ok(resp(
            200,
            FFMPEG_PROJECT.releases_url,
            &[],
            r#"<a href="/eugeneware/ffmpeg-static/releases/tag/b7.5.0">release</a>"#,
        )),
    ]);

    let info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut http, 1_000);

    assert_eq!(info.source, ReleaseResolveSource::Html);
    assert_eq!(info.tag, "b7.5.0");
}

#[test]
fn resolver_uses_atom_after_html_failure() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut http = MockHttp::new(vec![
        Ok(resp(500, LIBAVIF_PROJECT.api_url, &[], "")),
        Ok(resp(200, LIBAVIF_PROJECT.latest_url, &[], "")),
        Ok(resp(
            200,
            LIBAVIF_PROJECT.releases_url,
            &[],
            "<html></html>",
        )),
        Ok(resp(
            200,
            LIBAVIF_PROJECT.atom_url,
            &[],
            r#"<feed><entry><id>https://github.com/AOMediaCodec/libavif/releases/tag/v1.4.0</id></entry></feed>"#,
        )),
    ]);

    let info = resolve_github_release_with_http(LIBAVIF_PROJECT, &mut http, 1_000);

    assert_eq!(info.source, ReleaseResolveSource::Atom);
    assert_eq!(info.tag, "v1.4.0");
    assert_eq!(info.version, "1.4.0");
}

#[test]
fn resolver_uses_pinned_when_all_remote_sources_fail() {
    let _guard = crate::ffui_core::tools::tests_runtime::TEST_MUTEX
        .lock()
        .unwrap();
    reset_test_state();

    let mut http = MockHttp::new(vec![
        Ok(resp(500, FFMPEG_PROJECT.api_url, &[], "")),
        Err(anyhow!("redirect network failure")),
        Ok(resp(200, FFMPEG_PROJECT.releases_url, &[], "<html></html>")),
        Ok(resp(200, FFMPEG_PROJECT.atom_url, &[], "<feed></feed>")),
    ]);

    let info = resolve_github_release_with_http(FFMPEG_PROJECT, &mut http, 1_000);

    assert_eq!(info.source, ReleaseResolveSource::Pinned);
    assert_eq!(info.tag, FFMPEG_STATIC_TAG);
    assert_eq!(info.version, FFMPEG_STATIC_VERSION);
    assert!(FFMPEG_RELEASE_CACHE.lock_unpoisoned().is_none());
}
