use super::*;
use serde_json::json;

fn export_fixture(name: &str, source: &Path) {
    if let Some(directory) = std::env::var_os("FFUI_MEDIA_PREVIEW_FIXTURE_DIR") {
        let directory = PathBuf::from(directory);
        fs::create_dir_all(&directory).unwrap();
        fs::copy(source, directory.join(name)).unwrap();
    }
}

fn tools() -> ExternalToolSettings {
    ExternalToolSettings {
        ffmpeg_path: Some(
            if cfg!(target_os = "linux") {
                "/usr/bin/ffmpeg"
            } else {
                "ffmpeg"
            }
            .into(),
        ),
        ffprobe_path: Some(
            if cfg!(target_os = "linux") {
                "/usr/bin/ffprobe"
            } else {
                "ffprobe"
            }
            .into(),
        ),
        ..ExternalToolSettings::default()
    }
}

fn generate(arguments: &[&str], output: &Path) {
    let configuration = tools();
    let result = run_preview_command(
        Command::new(configuration.ffmpeg_path.expect("ffmpeg"))
            .args(["-y", "-hide_banner", "-v", "error", "-filter_threads", "1"])
            .args(arguments)
            .arg(output),
        Duration::from_secs(20),
    )
    .expect("generate fixture");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn media_preview_classification_uses_streams_and_container_not_task_or_extension() {
    let audio = parse_preview_info(
        &json!({"format":{"format_name":"matroska,webm","duration":"3.5"}, "streams":[
            {"codec_type":"video","disposition":{"attached_pic":1}}, {"codec_type":"audio"}
        ]}),
    )
    .expect("covered audio");
    assert_eq!(audio.kind, PreviewMediaKind::Audio);
    assert_eq!(audio.duration_seconds, Some(3.5));
    assert_eq!(
        parse_preview_info(
            &json!({"format":{"format_name":"png_pipe"},"streams":[{"codec_type":"video"}]})
        )
        .unwrap()
        .kind,
        PreviewMediaKind::Image
    );
    assert_eq!(parse_preview_info(&json!({"format":{"format_name":"matroska,webm"},"streams":[{"codec_type":"video"},{"codec_type":"audio"}]})).unwrap().kind, PreviewMediaKind::Video);
    assert_eq!(
        parse_preview_info(
            &json!({"format":{"duration":"N/A"},"streams":[{"codec_type":"audio"}]})
        )
        .unwrap()
        .duration_seconds,
        None
    );
    assert!(parse_preview_info(&json!({"streams":[{"codec_type":"subtitle"}]})).is_err());
    assert_eq!(parse_preview_info(&json!({"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2", "tags":{"major_brand":"avif"}},"streams":[{"codec_type":"video"}]})).unwrap().kind, PreviewMediaKind::Image);
}

#[test]
fn media_preview_audio_only_mkv_becomes_complete_aac_without_changing_source() {
    let _env_lock = crate::test_support::env_lock();
    super::super::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("音楽 mixed path.mkv");
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-c:a",
            "pcm_s16le",
        ],
        &source,
    );
    let original = fs::read(&source).unwrap();
    let configuration = tools();
    assert_eq!(
        probe_media_preview(source.to_str().unwrap(), &configuration)
            .unwrap()
            .kind,
        PreviewMediaKind::Audio
    );
    let cache = directory.path().join("cache");
    let converted = prepare_in_cache(
        &source,
        PreviewMediaKind::Audio,
        Path::new(configuration.ffmpeg_path.as_ref().unwrap()),
        &cache,
    )
    .unwrap();
    let info = probe_media_preview(converted.to_str().unwrap(), &configuration).unwrap();
    assert_eq!(info.kind, PreviewMediaKind::Audio);
    assert!((info.duration_seconds.unwrap() - 2.0).abs() < 0.1);
    let decode = run_preview_command(
        Command::new(configuration.ffmpeg_path.as_ref().unwrap())
            .args(["-v", "error", "-i"])
            .arg(&converted)
            .args(["-f", "null", "-"]),
        Duration::from_secs(20),
    )
    .unwrap();
    assert!(decode.status.success());
    export_fixture("audio-preview.m4a", &converted);
    export_fixture("media-preview-audio.mkv", &source);
    assert_eq!(fs::read(&source).unwrap(), original);
    assert_eq!(
        prepare_in_cache(
            &source,
            PreviewMediaKind::Audio,
            Path::new("missing-ffmpeg"),
            &cache
        )
        .unwrap(),
        converted
    );
    assert!(
        fs::read_dir(cache.join("frames"))
            .unwrap()
            .all(|entry| entry.unwrap().path().extension().unwrap() != "part")
    );
}

#[test]
fn media_preview_image_decode_and_changed_source_have_distinct_cache_entries() {
    let _env_lock = crate::test_support::env_lock();
    super::super::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("画像.tiff");
    let configuration = tools();
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red@0.5:s=33x35,format=rgba",
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgba",
            "-compression_algo",
            "raw",
        ],
        &source,
    );
    assert_eq!(
        probe_media_preview(source.to_str().unwrap(), &configuration)
            .unwrap()
            .kind,
        PreviewMediaKind::Image
    );
    let original = fs::read(&source).unwrap();
    let cache = directory.path().join("cache");
    let ffmpeg = Path::new(configuration.ffmpeg_path.as_ref().unwrap());
    let converted = prepare_in_cache(&source, PreviewMediaKind::Image, ffmpeg, &cache).unwrap();
    assert!(
        fs::read(&converted)
            .unwrap()
            .starts_with(b"\x89PNG\r\n\x1a\n")
    );
    assert_eq!(
        probe_media_preview(converted.to_str().unwrap(), &configuration)
            .unwrap()
            .kind,
        PreviewMediaKind::Image
    );
    assert_eq!(fs::read(&source).unwrap(), original);
    let pixels = run_preview_command(
        Command::new(configuration.ffmpeg_path.as_ref().unwrap())
            .args(["-v", "error", "-i"])
            .arg(&converted)
            .args(["-pix_fmt", "rgba", "-f", "rawvideo", "-"]),
        Duration::from_secs(20),
    )
    .unwrap();
    assert!(pixels.status.success());
    assert_eq!(pixels.stdout.len(), 33 * 35 * 4);
    assert!((120..=135).contains(&pixels.stdout[3]));
    export_fixture("image-preview.png", &converted);
    export_fixture("media-preview-image.tiff", &source);
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x64",
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgba",
            "-compression_algo",
            "raw",
        ],
        &source,
    );
    let second = prepare_in_cache(&source, PreviewMediaKind::Image, ffmpeg, &cache).unwrap();
    assert_ne!(converted, second);
    assert_ne!(fs::read(converted).unwrap(), fs::read(second).unwrap());
}

#[test]
fn media_preview_failure_preserves_unmanaged_files_and_cleans_parts() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("invalid.mkv");
    fs::write(&source, "not media").unwrap();
    let cache = directory.path().join("cache");
    let error = prepare_in_cache(
        &source,
        PreviewMediaKind::Audio,
        Path::new("missing-preview-ffmpeg"),
        &cache,
    )
    .unwrap_err();
    assert!(format!("{error:#}").contains("failed to launch"));
    assert_eq!(fs::read(&source).unwrap(), b"not media");
    assert_eq!(fs::read_dir(cache.join("frames")).unwrap().count(), 0);
    let ffmpeg_failure = prepare_in_cache(
        &source,
        PreviewMediaKind::Audio,
        Path::new(tools().ffmpeg_path.as_ref().unwrap()),
        &cache,
    )
    .unwrap_err();
    assert!(format!("{ffmpeg_failure:#}").contains("media preview conversion failed"));
    assert_eq!(fs::read(&source).unwrap(), b"not media");
    assert_eq!(fs::read_dir(cache.join("frames")).unwrap().count(), 0);
    assert!(readable_source(directory.path().join("missing.flac").to_str().unwrap()).is_err());
    assert!(readable_source(directory.path().to_str().unwrap()).is_err());
}

#[test]
fn media_preview_timeout_reaps_the_background_process() {
    let started = Instant::now();
    let mut command = Command::new(tools().ffmpeg_path.unwrap());
    command
        .args([
            "-nostdin",
            "-v",
            "error",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=duration=30",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_background_command(&mut command);
    let child = PreviewChild(command.spawn().unwrap());
    let pid = sysinfo::Pid::from_u32(child.0.id());
    let error = wait_preview_child(child, Duration::from_millis(50)).unwrap_err();
    assert!(error.to_string().contains("timed out"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!sysinfo::System::new().refresh_process(pid));
}

#[test]
fn media_preview_avif_container_brand_survives_an_unknown_extension() {
    let _env_lock = crate::test_support::env_lock();
    super::super::tools::reset_tool_probe_cache_for_tests();
    let directory = tempfile::tempdir().unwrap();
    let image = directory.path().join("source.avif");
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=32x32",
            "-frames:v",
            "1",
            "-c:v",
            "libaom-av1",
            "-cpu-used",
            "8",
        ],
        &image,
    );
    let source = directory.path().join("unknown.data");
    fs::rename(image, &source).unwrap();
    assert_eq!(
        probe_media_preview(source.to_str().unwrap(), &tools())
            .unwrap()
            .kind,
        PreviewMediaKind::Image
    );
    let converted = prepare_in_cache(
        &source,
        PreviewMediaKind::Image,
        Path::new(tools().ffmpeg_path.as_ref().unwrap()),
        &directory.path().join("cache"),
    )
    .unwrap();
    assert!(
        fs::read(&converted)
            .unwrap()
            .starts_with(b"\x89PNG\r\n\x1a\n")
    );
}

#[test]
fn media_preview_wire_contract_matches_frontend_fixture() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/media-preview-contract.json")).unwrap();
    for value in fixture["info"].as_array().unwrap() {
        let info: MediaPreviewInfo = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(info).unwrap(), *value);
    }
    assert_eq!(fixture["probe"]["command"], "probe_media_preview_info");
    assert_eq!(
        fixture["prepare"]["command"],
        "prepare_native_media_preview"
    );
    let probe = include_str!("../../commands/tools/media_preview.rs");
    assert!(probe.contains("pub async fn probe_media_preview_info"));
    assert!(probe.contains("pub async fn prepare_native_media_preview"));
}

mod resources;
