use super::common::*;
use crate::ffui_core::tools::ExternalToolKind;

#[test]
fn manual_tool_download_records_download_metadata_without_custom_path_override() {
    let _settings = setup_settings_store_for_tests();
    let engine = make_engine_with_preset();

    let initial = engine.settings();
    assert!(
        initial.tools.ffmpeg_path.is_none(),
        "precondition: ffmpeg_path should be empty for a fresh engine"
    );

    let path = "C:/tools/ffmpeg-from-test.exe";
    engine.record_manual_tool_download(ExternalToolKind::Ffmpeg, path);

    let updated = engine.settings();
    assert!(
        updated.tools.ffmpeg_path.is_none(),
        "record_manual_tool_download must not populate settings.tools.ffmpeg_path (CUSTOM override)"
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
    assert_eq!(
        serde_json::to_value(
            crate::ffui_core::settings::load_settings()
                .expect("persisted settings")
                .tools
                .downloaded
        )
        .expect("serialize persisted metadata"),
        serde_json::to_value(updated.tools.downloaded).expect("serialize confirmed metadata")
    );
}
