use std::sync::Arc;
use std::sync::atomic::{
    AtomicUsize,
    Ordering,
};

use crate::ffui_core::engine::TranscodingEngine;
use crate::ffui_core::network_proxy;

#[test]
fn engine_new_does_not_resolve_system_proxy_on_startup_path() {
    let _lock = crate::test_support::env_lock();
    let _env_guard = crate::test_support::EnvVarGuard::capture([
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]);
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        crate::test_support::remove_env(key);
    }

    let calls = Arc::new(AtomicUsize::new(0));
    let calls_clone = calls.clone();
    let _hook_guard = network_proxy::install_test_platform_proxy_hook(Arc::new(move || {
        calls_clone.fetch_add(1, Ordering::SeqCst);
        None
    }));

    let data_root = tempfile::tempdir().expect("temp data root");
    let _root_guard = crate::ffui_core::data_root::override_data_root_dir_for_tests(
        data_root.path().to_path_buf(),
    );

    let _engine = TranscodingEngine::new().expect("engine should start");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "engine startup must not trigger system proxy discovery"
    );
}
