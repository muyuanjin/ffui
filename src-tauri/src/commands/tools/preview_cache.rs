use tauri::State;

use crate::ffui_core::{
    TranscodingEngine, cleanup_unreferenced_previews, clear_fallback_frame_cache,
    previews_root_dir_best_effort, referenced_preview_filenames,
};

fn wait_for_queue_recovery(engine: &TranscodingEngine) {
    use std::sync::atomic::Ordering;

    if engine.inner.queue_recovery_done.load(Ordering::Acquire) {
        return;
    }

    let guard = engine.inner.state.lock().expect("engine state poisoned");
    let _guard = engine
        .inner
        .cv
        .wait_while(guard, |_| {
            !engine.inner.queue_recovery_done.load(Ordering::Acquire)
        })
        .expect("engine state poisoned");
}

fn cleanup_preview_caches_worker(
    engine: TranscodingEngine,
    previews_root_override: Option<std::path::PathBuf>,
) {
    // This cache is not keyed to queue recovery and is safe to clear eagerly.
    let _ = clear_fallback_frame_cache();

    // Only delete unreferenced previews once crash recovery has finished,
    // otherwise a partial/empty job list can cause valid previews to be purged.
    wait_for_queue_recovery(&engine);

    let preview_paths = engine
        .queue_state()
        .jobs
        .into_iter()
        .filter_map(|j| j.preview_path);
    let referenced = referenced_preview_filenames(preview_paths);

    let previews_root = match previews_root_override {
        Some(path) => Ok(path),
        None => previews_root_dir_best_effort(),
    };

    match previews_root {
        Ok(previews_root) => {
            let _ = cleanup_unreferenced_previews(&previews_root, &referenced);
        }
        Err(err) => {
            eprintln!("preview cache cleanup skipped: failed to resolve previews root: {err:#}");
        }
    }
}

/// Best-effort, non-blocking cleanup for preview artifacts under the app-managed `previews/` root.
///
/// - Deletes `previews/*.jpg|png|webp` files that are no longer referenced by any job in the queue.
/// - Clears `previews/fallback-cache/frames/*` (fallback scrub frames).
#[tauri::command]
pub fn cleanup_preview_caches_async(engine: State<TranscodingEngine>) -> bool {
    let engine: TranscodingEngine = (*engine).clone();

    std::thread::Builder::new()
        .name("ffui-preview-cache-cleanup".to_string())
        .spawn(move || {
            cleanup_preview_caches_worker(engine, None);
        })
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::Ordering;
    use tempfile::tempdir;

    #[test]
    fn cleanup_preview_caches_worker_waits_for_recovery_before_deleting_previews() {
        let engine = TranscodingEngine::new_for_tests();

        let dir = tempdir().expect("tempdir");
        let previews_root = dir.path().join("previews");
        fs::create_dir_all(&previews_root).expect("create previews root");

        let jpg = previews_root.join("preview.jpg");
        let png = previews_root.join("preview.png");
        let txt = previews_root.join("note.txt");
        fs::write(&jpg, b"jpg").unwrap();
        fs::write(&png, b"png").unwrap();
        fs::write(&txt, b"txt").unwrap();

        let engine_for_thread = engine.clone();
        let previews_root_for_thread = previews_root.clone();
        let handle = std::thread::spawn(move || {
            cleanup_preview_caches_worker(engine_for_thread, Some(previews_root_for_thread));
        });

        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            jpg.exists(),
            "jpg should not be deleted before recovery finishes"
        );
        assert!(
            png.exists(),
            "png should not be deleted before recovery finishes"
        );
        assert!(txt.exists(), "non-image files are never deleted");

        // Once recovery is marked complete and waiters are notified, empty
        // queues can safely clear all preview images.
        engine
            .inner
            .queue_recovery_done
            .store(true, Ordering::Release);
        engine.inner.cv.notify_all();

        handle.join().expect("cleanup thread should exit");
        assert!(
            !jpg.exists(),
            "jpg should be deleted after recovery completes"
        );
        assert!(
            !png.exists(),
            "png should be deleted after recovery completes"
        );
        assert!(txt.exists(), "non-image files are never deleted");
    }
}
