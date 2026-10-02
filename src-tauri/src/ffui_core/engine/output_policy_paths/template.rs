pub(in crate::ffui_core::engine) fn infer_template_output_codecs(
    template: &str,
) -> (Option<String>, Option<String>) {
    // Best-effort: scan output-scoped `-c:v <x>` and `-c:a <y>` before OUTPUT.
    // This mirrors `infer_template_output_muxer` and intentionally avoids full
    // shell parsing.
    let mut tokens = crate::ffui_core::engine::template_args::split_template_args(template);
    crate::ffui_core::engine::template_args::strip_leading_ffmpeg_program(&mut tokens);
    let Some(output_index) = tokens.iter().position(|t| t.as_str() == "OUTPUT") else {
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
    let start = last_input_index.map_or(0, |idx| idx + 1);

    let mut v: Option<String> = None;
    let mut a: Option<String> = None;
    let mut j = start;
    while j + 1 < output_index {
        match tokens[j].as_str() {
            "-c:v" => {
                v = Some(tokens[j + 1].clone());
                j += 2;
            }
            "-c:a" => {
                a = Some(tokens[j + 1].clone());
                j += 2;
            }
            _ => j += 1,
        }
    }

    (v, a)
}

pub(super) fn infer_template_output_muxer(template: &str) -> Option<String> {
    // Best-effort: look for an output-scoped `-f <muxer>` before OUTPUT.
    // We keep this lightweight and do not attempt full shell parsing.
    let mut tokens = crate::ffui_core::engine::template_args::split_template_args(template);
    crate::ffui_core::engine::template_args::strip_leading_ffmpeg_program(&mut tokens);
    let output_index = tokens.iter().position(|t| t.as_str() == "OUTPUT")?;
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
    let start = last_input_index.map_or(0, |idx| idx + 1);
    let mut j = start;
    let mut fmt: Option<String> = None;
    while j + 1 < output_index {
        if tokens[j].as_str() == "-f" {
            fmt = Some(tokens[j + 1].clone());
            j += 2;
            continue;
        }
        j += 1;
    }
    fmt
}

pub(super) fn infer_template_image_extension(template: &str) -> Option<&'static str> {
    let tokens = super::super::manual_execution::parse_command(template).ok()?;
    let output_index = tokens.iter().position(|token| token == "OUTPUT")?;
    let start = tokens[..output_index]
        .iter()
        .rposition(|token| token == "-i")?
        + 2;
    let mut codec = None;
    let mut index = start;
    while index < output_index {
        let token = tokens[index].as_str();
        if !token.starts_with('-') {
            codec = None;
            index += 1;
            continue;
        }
        if matches!(
            token,
            "-an"
                | "-sn"
                | "-dn"
                | "-vn"
                | "-shortest"
                | "-y"
                | "-n"
                | "-hide_banner"
                | "-nostats"
                | "-bitexact"
                | "-copyts"
                | "-start_at_zero"
        ) {
            index += 1;
            continue;
        }
        let value = tokens.get(index + 1).filter(|_| index + 1 < output_index)?;
        match token {
            "-c" | "-codec" | "-c:v" | "-codec:v" | "-c:v:0" | "-codec:v:0" | "-vcodec" => {
                codec = Some(value.as_str())
            }
            "-acodec" | "-c:a" | "-codec:a" | "-c:a:0" | "-codec:a:0" => {}
            _ if matches!(
                token.split(':').next()?,
                "-map"
                    | "-frames"
                    | "-vf"
                    | "-filter"
                    | "-filter_script"
                    | "-f"
                    | "-t"
                    | "-to"
                    | "-ss"
                    | "-r"
                    | "-s"
                    | "-pix_fmt"
                    | "-q"
                    | "-qscale"
                    | "-b"
                    | "-threads"
                    | "-metadata"
                    | "-map_metadata"
                    | "-update"
                    | "-pattern_type"
                    | "-vsync"
                    | "-fps_mode"
                    | "-loop"
            ) => {}
            _ => return None,
        }
        index += 2;
    }
    match codec? {
        "png" => Some("png"),
        "mjpeg" => Some("jpg"),
        "bmp" => Some("bmp"),
        "tiff" => Some("tiff"),
        _ => None,
    }
}
