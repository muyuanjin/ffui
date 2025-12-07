use super::common::*;
use crate::ffui_core::tools::ExternalToolKind;

#[test]
fn manual_tool_download_updates_settings_paths_even_without_metadata() {
    let engine = make_engine_with_preset();

    let initial = engine.settings();
    assert!(
        initial.tools.ffmpeg_path.is_none(),
        "precondition: ffmpeg_path should be empty for a fresh engine"
    );

    let path = "C:/tools/ffmpeg-from-test.exe";
    engine.record_manual_tool_download(ExternalToolKind::Ffmpeg, path);

    let updated = engine.settings();
    assert_eq!(
        updated.tools.ffmpeg_path.as_deref(),
        Some(path),
        "record_manual_tool_download must persist the provided binary path into settings.tools.ffmpeg_path"
    );

    let downloaded = updated
        .tools
        .downloaded
        .as_ref()
        .expect("downloaded metadata should be initialised for ffmpeg");
    assert!(
        downloaded.ffmpeg.is_some(),
        "downloaded.ffmpeg metadata entry should be populated after manual download recording"
    );
}
