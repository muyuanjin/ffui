use super::TranscodingEngine;

pub(super) fn spawn_preview_cache_gc(engine: TranscodingEngine) {
    std::thread::Builder::new()
        .name("ffui-preview-cache-gc".to_string())
        .spawn(move || {
            use std::sync::atomic::Ordering;
            use std::time::Duration;

            // Queue crash-recovery runs on a separate thread during startup.
            // Avoid deleting `previews/*.jpg` before the queue has been restored,
            // otherwise valid preview thumbnails may be removed and the UI will
            // temporarily show broken preview cards until regeneration happens.
            let _ = crate::ffui_core::clear_fallback_frame_cache();

            if !engine.inner.queue_recovery_done.load(Ordering::Acquire) {
                let guard = engine.inner.state.lock().expect("engine state poisoned");
                let _guard = engine
                    .inner
                    .cv
                    .wait_while(guard, |_| {
                        !engine.inner.queue_recovery_done.load(Ordering::Acquire)
                    })
                    .expect("engine state poisoned");
            }

            // Give startup a little breathing room so background I/O is less
            // likely to contend with UI initialization.
            std::thread::sleep(Duration::from_secs(1));

            let preview_paths = engine
                .queue_state()
                .jobs
                .into_iter()
                .filter_map(|j| j.preview_path);

            let referenced = crate::ffui_core::referenced_preview_filenames(preview_paths);
            if let Ok(previews_root) = crate::ffui_core::previews_root_dir_best_effort() {
                // If the queue is empty after recovery, the referenced set is
                // empty and all task previews can be safely deleted.
                let _ =
                    crate::ffui_core::cleanup_unreferenced_previews(&previews_root, &referenced);
            }
        })
        .expect("failed to spawn preview cache cleanup thread");
}
