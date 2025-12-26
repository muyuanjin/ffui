use super::TranscodingEngine;
use crate::sync_ext::{CondvarExt, MutexExt};

pub(super) fn spawn_preview_cache_gc(engine: TranscodingEngine) {
    let result = std::thread::Builder::new()
        .name("ffui-preview-cache-gc".to_string())
        .spawn(move || {
            use std::sync::atomic::Ordering;
            use std::time::Duration;

            // Queue crash-recovery runs on a separate thread during startup.
            // Avoid deleting `previews/*.jpg` before the queue has been restored,
            // otherwise valid preview thumbnails may be removed and the UI will
            // temporarily show broken preview cards until regeneration happens.
            drop(crate::ffui_core::clear_fallback_frame_cache());

            if !engine.inner.queue_recovery_done.load(Ordering::Acquire) {
                let guard = engine.inner.state.lock_unpoisoned();
                let _guard = engine.inner.cv.wait_while_unpoisoned(guard, |_| {
                    !engine.inner.queue_recovery_done.load(Ordering::Acquire)
                });
            }

            // Give startup a little breathing room so background I/O is less
            // likely to contend with UI initialization.
            std::thread::park_timeout(Duration::from_secs(1));

            let preview_paths = engine
                .queue_state()
                .jobs
                .into_iter()
                .filter_map(|j| j.preview_path);

            let referenced = crate::ffui_core::referenced_preview_filenames(preview_paths);
            if let Ok(previews_root) = crate::ffui_core::previews_root_dir_best_effort() {
                // If the queue is empty after recovery, the referenced set is
                // empty and all task previews can be safely deleted.
                drop(crate::ffui_core::cleanup_unreferenced_previews(
                    &previews_root,
                    &referenced,
                ));
            }
        })
        .map(|_| ());

    if let Err(err) = result {
        crate::debug_eprintln!("failed to spawn preview cache cleanup thread: {err}");
    }
}
