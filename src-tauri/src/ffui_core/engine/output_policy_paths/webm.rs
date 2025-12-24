use super::template::infer_template_output_codecs;
use crate::ffui_core::domain::{AudioCodecType, EncoderType, FFmpegPreset};

pub(in crate::ffui_core::engine) fn should_fallback_webm(
    preset: Option<&FFmpegPreset>,
    input_ext: Option<&str>,
) -> bool {
    let Some(preset) = preset else {
        return true;
    };

    // Advanced template mode: best-effort parse the output-side -c:v/-c:a.
    // If we cannot determine codecs, do not force a fallback (avoid surprising
    // expert users who wrote a WebM-compatible template).
    if preset.advanced_enabled.unwrap_or(false)
        && let Some(template) = preset.ffmpeg_template.as_ref()
        && !template.trim().is_empty()
    {
        let (v, a) = infer_template_output_codecs(template);
        let Some(v) = v else {
            return false;
        };
        let Some(a) = a else {
            return false;
        };

        let video_ok = is_webm_video_codec(v.as_str(), input_ext);
        let audio_ok = is_webm_audio_codec(a.as_str(), input_ext);
        return !(video_ok && audio_ok);
    }

    // Structured mode: we know the selected encoder and audio strategy.
    let video_ok = match preset.video.encoder {
        EncoderType::Av1Nvenc
        | EncoderType::Av1Qsv
        | EncoderType::Av1Amf
        | EncoderType::LibSvtAv1 => true,
        EncoderType::Copy => input_ext
            .map(|e| e.eq_ignore_ascii_case("webm"))
            .unwrap_or(false),
        _ => false,
    };

    // FFUI currently only supports AAC or copy for audio; WebM needs Opus/Vorbis.
    let audio_ok = match preset.audio.codec {
        AudioCodecType::Copy => input_ext
            .map(|e| e.eq_ignore_ascii_case("webm"))
            .unwrap_or(false),
        _ => false,
    };

    !(video_ok && audio_ok)
}

fn is_webm_video_codec(codec: &str, input_ext: Option<&str>) -> bool {
    let c = codec.trim().to_ascii_lowercase();
    match c.as_str() {
        "vp8" | "libvpx" => true,
        "vp9" | "libvpx-vp9" => true,
        "av1" | "libaom-av1" | "libsvtav1" | "av1_nvenc" | "av1_qsv" | "av1_amf" => true,
        "copy" => input_ext
            .map(|e| e.eq_ignore_ascii_case("webm"))
            .unwrap_or(false),
        _ => false,
    }
}

fn is_webm_audio_codec(codec: &str, input_ext: Option<&str>) -> bool {
    let c = codec.trim().to_ascii_lowercase();
    match c.as_str() {
        "opus" | "libopus" => true,
        "vorbis" | "libvorbis" => true,
        "copy" => input_ext
            .map(|e| e.eq_ignore_ascii_case("webm"))
            .unwrap_or(false),
        _ => false,
    }
}
