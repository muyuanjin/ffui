use std::path::Path;

use crate::ffui_core::domain::{
    AudioCodecType,
    EncoderType,
    FFmpegPreset,
};

pub(super) fn should_fallback_webm_forced_container(preset: &FFmpegPreset, input: &Path) -> bool {
    let input_ext = input.extension().and_then(|e| e.to_str());

    // Advanced template mode: best-effort parse the output-side -c:v/-c:a. If we
    // cannot determine codecs, avoid forcing a fallback (expert user scenario).
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

    // Structured presets: we know the selected encoder and audio strategy.
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

    let audio_ok = match preset.audio.codec {
        AudioCodecType::Copy => input_ext
            .map(|e| e.eq_ignore_ascii_case("webm"))
            .unwrap_or(false),
        _ => false,
    };

    !(video_ok && audio_ok)
}

fn infer_template_output_codecs(template: &str) -> (Option<String>, Option<String>) {
    let tokens: Vec<&str> = template.split_whitespace().collect();
    let Some(output_index) = tokens.iter().position(|t| *t == "OUTPUT") else {
        return (None, None);
    };

    let mut i = 0usize;
    let mut last_input_index: Option<usize> = None;
    while i + 1 < output_index {
        if tokens[i] == "-i" {
            last_input_index = Some(i + 1);
            i += 2;
            continue;
        }
        i += 1;
    }
    let start = last_input_index.map(|idx| idx + 1).unwrap_or(0);

    let mut v: Option<String> = None;
    let mut a: Option<String> = None;
    let mut j = start;
    while j + 1 < output_index {
        match tokens[j] {
            "-c:v" => {
                v = Some(tokens[j + 1].to_string());
                j += 2;
            }
            "-c:a" => {
                a = Some(tokens[j + 1].to_string());
                j += 2;
            }
            _ => j += 1,
        }
    }

    (v, a)
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
