use crate::ffui_core::domain::FFmpegPreset;

fn preset_uses_advanced_template(preset: &FFmpegPreset) -> bool {
    preset.advanced_enabled.unwrap_or(false)
        && preset
            .ffmpeg_template
            .as_ref()
            .is_some_and(|template| !template.trim().is_empty())
}

pub(super) fn preset_uses_structured_two_pass(preset: &FFmpegPreset) -> bool {
    !preset_uses_advanced_template(preset)
        && preset.video.rate_control.is_bitrate_mode()
        && matches!(preset.video.pass, Some(1 | 2))
        && preset.video.bitrate_kbps.is_some_and(|bitrate| bitrate > 0)
        && !preset.video.encoder.is_copy()
}
