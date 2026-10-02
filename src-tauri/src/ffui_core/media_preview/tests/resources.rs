use super::*;
use base64::Engine;
use std::sync::{Arc, Barrier};

fn auxiliary_alpha_fixture() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(include_str!("../../../../tests/fixtures/auxiliary-alpha.avif.base64").trim())
        .unwrap()
}

fn assert_auxiliary_alpha_preview(bytes: &[u8]) {
    let _env_lock = crate::test_support::env_lock();
    super::super::super::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("transparent.unknown");
    fs::write(&source, bytes).unwrap();
    assert_eq!(
        probe_media_preview(source.to_str().unwrap(), &tools())
            .unwrap()
            .kind,
        PreviewMediaKind::Image
    );
    let cache = directory.path().join("cache");
    let result = prepare_in_cache(
        &source,
        PreviewMediaKind::Image,
        Path::new(tools().ffmpeg_path.as_ref().unwrap()),
        &cache,
    );
    match result {
        Ok(preview) => {
            let output = run_preview_command(
                Command::new(tools().ffmpeg_path.unwrap())
                    .args(["-v", "error", "-i"])
                    .arg(preview)
                    .args(["-pix_fmt", "rgba", "-f", "rawvideo", "-"]),
                Duration::from_secs(20),
            )
            .unwrap();
            assert!(output.status.success());
            assert_eq!(output.stdout.len(), 32 * 32 * 4);
            assert!(
                output
                    .stdout
                    .chunks_exact(4)
                    .all(|pixel| (120..=135).contains(&pixel[3]))
            );
        }
        Err(error) => {
            assert!(
                format!("{error:#}").contains("cannot preserve auxiliary AVIF/HEIF transparency")
            );
            assert!(
                !cache.join("frames").exists()
                    || fs::read_dir(cache.join("frames")).unwrap().count() == 0
            );
        }
    }
    assert_eq!(fs::read(source).unwrap(), bytes);
}

#[test]
fn media_preview_auxiliary_alpha_is_preserved_or_rejected_without_a_published_copy() {
    assert_auxiliary_alpha_preview(&auxiliary_alpha_fixture());
}

#[test]
fn media_preview_auxiliary_alpha_after_leading_free_box_is_preserved_or_rejected() {
    let mut bytes = auxiliary_alpha_fixture();
    for position in [127, 141] {
        let offset = u32::from_be_bytes(bytes[position..position + 4].try_into().unwrap()) + 8;
        bytes[position..position + 4].copy_from_slice(&offset.to_be_bytes());
    }
    let mut prefixed = vec![0, 0, 0, 8, b'f', b'r', b'e', b'e'];
    prefixed.extend(bytes);
    assert_eq!(prefixed.len(), 529);
    assert_auxiliary_alpha_preview(&prefixed);
}

#[test]
fn media_preview_size_cap_exit_zero_is_not_published_as_complete() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("long.wav");
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=30",
            "-c:a",
            "pcm_s16le",
        ],
        &source,
    );
    let original = fs::read(&source).unwrap();
    let ffmpeg = tools().ffmpeg_path.unwrap();
    let capped = directory.path().join("capped.m4a");
    let output = run_preview_command(
        Command::new(&ffmpeg)
            .args(conversion_args(&source, PreviewMediaKind::Audio, &capped, 16 * 1024).unwrap()),
        Duration::from_secs(20),
    )
    .unwrap();
    assert!(output.status.success());
    assert!(fs::metadata(capped).unwrap().len() >= 12 * 1024);
    let cache = directory.path().join("cache");
    let error = prepare_in_cache_with_limits(
        &source,
        PreviewMediaKind::Audio,
        Path::new(&ffmpeg),
        &cache,
        PreviewLimits {
            output_bytes: 16 * 1024,
            ..PreviewLimits::default()
        },
    )
    .unwrap_err();
    assert!(format!("{error:#}").contains("preview size limit"));
    assert_eq!(fs::read_dir(cache.join("frames")).unwrap().count(), 0);
    assert_eq!(fs::read(source).unwrap(), original);
}

#[test]
fn media_preview_cache_capacity_failure_cleans_the_unpublished_copy() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("tone.wav");
    generate(
        &["-f", "lavfi", "-i", "sine=duration=1", "-c:a", "pcm_s16le"],
        &source,
    );
    let original = fs::read(&source).unwrap();
    let cache = directory.path().join("cache");
    let limits = PreviewLimits {
        cache_bytes: 1,
        ..PreviewLimits::default()
    };
    let error = prepare_in_cache_with_limits(
        &source,
        PreviewMediaKind::Audio,
        Path::new(tools().ffmpeg_path.as_ref().unwrap()),
        &cache,
        limits,
    )
    .unwrap_err();
    assert!(format!("{error:#}").contains("cache capacity"));
    assert_eq!(fs::read_dir(cache.join("frames")).unwrap().count(), 0);
    assert_eq!(fs::read(&source).unwrap(), original);
    let retained = cache.join("frames/0000000000000000.png");
    fs::write(&retained, "retained-file").unwrap();
    let error = super::super::cache::reclaim(&cache, Some(&retained), 1).unwrap_err();
    assert!(format!("{error:#}").contains("cache capacity unavailable"));
    assert_eq!(fs::read(retained).unwrap(), b"retained-file");
}

#[test]
fn media_preview_same_source_concurrent_requests_share_one_complete_copy() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("same.wav");
    generate(
        &["-f", "lavfi", "-i", "sine=duration=1", "-c:a", "pcm_s16le"],
        &source,
    );
    let cache = directory.path().join("cache");
    let ffmpeg = PathBuf::from(tools().ffmpeg_path.unwrap());
    let barrier = Arc::new(Barrier::new(4));
    std::thread::scope(|scope| {
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let barrier = barrier.clone();
                let source = &source;
                let ffmpeg = &ffmpeg;
                let cache = &cache;
                scope.spawn(move || {
                    barrier.wait();
                    prepare_in_cache(source, PreviewMediaKind::Audio, ffmpeg, cache).unwrap()
                })
            })
            .collect();
        let paths: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert!(paths.iter().all(|path| path == &paths[0]));
    });
    assert_eq!(fs::read_dir(cache.join("frames")).unwrap().count(), 1);
}

#[test]
fn media_preview_different_sources_reserve_budget_without_removing_active_or_unmanaged_files() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("tone.wav");
    generate(
        &["-f", "lavfi", "-i", "sine=duration=1", "-c:a", "pcm_s16le"],
        &source,
    );
    let sources: Vec<_> = (0..4)
        .map(|number| {
            let path = directory.path().join(format!("source-{number}.wav"));
            fs::copy(&source, &path).unwrap();
            path
        })
        .collect();
    let cache = directory.path().join("cache");
    fs::create_dir_all(cache.join("frames")).unwrap();
    let unmanaged = cache.join("frames/unmanaged.png");
    let active = cache.join("frames/0000000000000000.part");
    fs::write(&unmanaged, "unmanaged").unwrap();
    fs::write(&active, "active").unwrap();
    let old = cache.join("frames/0000000000000000.m4a");
    fs::File::create(&old).unwrap().set_len(100_000).unwrap();
    let limits = PreviewLimits {
        cache_bytes: 60_000,
        ..PreviewLimits::default()
    };
    let ffmpeg = PathBuf::from(tools().ffmpeg_path.unwrap());
    let barrier = Arc::new(Barrier::new(4));
    std::thread::scope(|scope| {
        let threads: Vec<_> = sources
            .iter()
            .map(|source| {
                let barrier = barrier.clone();
                let ffmpeg = &ffmpeg;
                let cache = &cache;
                scope.spawn(move || {
                    barrier.wait();
                    prepare_in_cache_with_limits(
                        source,
                        PreviewMediaKind::Audio,
                        ffmpeg,
                        cache,
                        limits,
                    )
                    .unwrap()
                })
            })
            .collect();
        for thread in threads {
            assert!(thread.join().unwrap().is_absolute());
        }
    });
    assert!(!old.exists());
    let total: u64 = fs::read_dir(cache.join("frames"))
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "m4a")
        })
        .map(|entry| entry.metadata().unwrap().len())
        .sum();
    assert!(total > 0 && total <= limits.cache_bytes);
    assert_eq!(fs::read(unmanaged).unwrap(), b"unmanaged");
    assert_eq!(fs::read(active).unwrap(), b"active");
    assert!(
        sources
            .iter()
            .all(|path| fs::read(path).unwrap() == fs::read(&source).unwrap())
    );
}
