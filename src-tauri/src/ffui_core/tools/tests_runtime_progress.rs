use crate::sync_ext::MutexExt;

#[test]
fn mark_download_progress_without_total_keeps_progress_indeterminate() {
    let _guard = super::tests_runtime::TEST_MUTEX.lock().unwrap();

    {
        let mut map = super::types::TOOL_DOWNLOAD_STATE.lock_unpoisoned();
        map.clear();
    }

    super::runtime_state::mark_download_progress(super::ExternalToolKind::Ffmpeg, 1024, None);

    let map = super::types::TOOL_DOWNLOAD_STATE.lock_unpoisoned();
    let state = map
        .get(&super::ExternalToolKind::Ffmpeg)
        .expect("download state must exist after progress tick");
    assert!(
        state.progress.is_none(),
        "when total is unknown, progress must remain None so the UI shows an indeterminate bar"
    );
}
