fn output_options(template: &str) -> Option<Vec<(String, String)>> {
    let tokens = super::super::manual_execution::parse_command(template).ok()?;
    let output_index = tokens.iter().position(|token| token == "OUTPUT")?;
    let mut index = tokens[..output_index]
        .iter()
        .rposition(|token| token == "-i")
        .map_or(0, |index| index + 2);
    let mut options = Vec::new();
    while index < output_index {
        let token = tokens[index].as_str();
        if token == "--" {
            if index + 1 == output_index {
                return Some(options);
            }
            options.clear();
            index += 2;
            continue;
        }
        if !token.starts_with('-') {
            options.clear();
            index += 1;
            continue;
        }
        let option = token.split(':').next()?.trim_start_matches('-');
        if super::super::manual_execution::is_valueless_option(option) {
            index += 1;
            continue;
        }
        let value = tokens.get(index + 1).filter(|_| index + 1 < output_index)?;
        options.push((token.to_string(), value.clone()));
        index += 2;
    }
    Some(options)
}

pub(in crate::ffui_core::engine) fn infer_template_output_codecs(
    template: &str,
) -> (Option<String>, Option<String>) {
    let Some(options) = output_options(template) else {
        return (None, None);
    };
    let mut video = None;
    let mut audio = None;
    for (option, value) in options {
        match option.as_str() {
            "-c" | "-codec" => {
                video = Some(value.clone());
                audio = Some(value);
            }
            "-vcodec" | "-c:v" | "-codec:v" | "-c:v:0" | "-codec:v:0" => video = Some(value),
            "-acodec" | "-c:a" | "-codec:a" | "-c:a:0" | "-codec:a:0" => audio = Some(value),
            _ => {}
        }
    }
    (video, audio)
}

pub(in crate::ffui_core::engine) fn infer_template_output_muxer(template: &str) -> Option<String> {
    output_options(template)?
        .into_iter()
        .rev()
        .find_map(|(option, value)| (option == "-f").then_some(value))
}

pub(in crate::ffui_core::engine) fn infer_template_image_extension(
    template: &str,
) -> Option<&'static str> {
    match infer_template_output_codecs(template).0?.as_str() {
        "png" => Some("png"),
        "mjpeg" => Some("jpg"),
        "bmp" => Some("bmp"),
        "tiff" => Some("tiff"),
        _ => None,
    }
}
