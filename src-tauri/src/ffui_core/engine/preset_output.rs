use crate::ffui_core::domain::{FFmpegPreset, JobType, media_type_for_extension};

fn audio_only_maps<'a>(maps: impl Iterator<Item = &'a str>) -> bool {
    let positive: Vec<_> = maps.filter(|value| !value.starts_with('-')).collect();
    !positive.is_empty()
        && positive.iter().all(|value| {
            let mut parts = value.trim_end_matches('?').split(':');
            parts
                .next()
                .is_some_and(|input| input.parse::<u32>().is_ok())
                && parts.next() == Some("a")
        })
}

pub(super) fn output_type(preset: Option<&FFmpegPreset>, input_extension: &str) -> JobType {
    let input_type = media_type_for_extension(input_extension);
    let Some(preset) = preset else {
        return input_type;
    };
    if !preset.advanced_enabled.unwrap_or(false) {
        return if preset
            .mapping
            .as_ref()
            .and_then(|mapping| mapping.maps.as_ref())
            .is_some_and(|maps| audio_only_maps(maps.iter().map(String::as_str)))
        {
            JobType::Audio
        } else {
            input_type
        };
    }
    if let Some(kind) = preset.output_kind {
        return kind;
    }
    let Some(template) = preset.ffmpeg_template.as_deref() else {
        return JobType::Other;
    };
    let Ok(tokens) = super::manual_execution::parse_command(template) else {
        return JobType::Other;
    };
    if tokens
        .iter()
        .filter(|token| token.as_str() == "OUTPUT")
        .count()
        != 1
        || tokens.last().is_none_or(|token| token != "OUTPUT")
    {
        return JobType::Other;
    }
    if tokens
        .iter()
        .position(|token| token == "--")
        .is_some_and(|index| index + 2 != tokens.len())
    {
        return JobType::Other;
    }
    let start = tokens
        .iter()
        .rposition(|token| token == "-i")
        .map_or(0, |index| index + 2);
    let mut no_video = false;
    let mut muxer = None;
    let mut video_codec = false;
    let mut maps = Vec::new();
    let mut index = start;
    while index + 1 < tokens.len() {
        let option = tokens[index].as_str();
        if matches!(
            option,
            "-vn" | "-an" | "-sn" | "-dn" | "-y" | "-n" | "-shortest" | "-hide_banner" | "-nostats"
        ) {
            no_video |= option == "-vn";
            index += 1;
        } else if option.starts_with('-') {
            let value = tokens[index + 1].as_str();
            if option == "-filter_complex" {
                return JobType::Other;
            }
            if option == "-f" {
                muxer = Some(value);
            }
            video_codec |= matches!(option, "-c:v" | "-codec:v" | "-vcodec");
            if option == "-map" {
                maps.push(value);
            }
            index += 2;
        } else {
            return JobType::Other;
        }
    }
    if muxer.is_some_and(|format| {
        format == "image2" || media_type_for_extension(format) == JobType::Image
    }) {
        return JobType::Image;
    }
    if no_video
        || audio_only_maps(maps.iter().copied())
        || muxer.is_some_and(|format| {
            super::ffmpeg_args::is_audio_only_muxer(
                &super::ffmpeg_args::normalize_container_format(format),
            )
        })
    {
        return JobType::Audio;
    }
    if video_codec {
        JobType::Video
    } else {
        JobType::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffui_core::domain::OutputContainerPolicy;
    use std::path::Path;

    #[test]
    fn preset_target_output_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/preset-output-planning-contract.json"
        ))
        .expect("contract");
        for case in contract["cases"].as_array().expect("cases") {
            let mut preset = crate::test_support::make_ffmpeg_preset_for_tests("target");
            preset.advanced_enabled = Some(true);
            preset.ffmpeg_template = Some(case["template"].as_str().expect("template").into());
            preset.output_kind = case
                .get("declared")
                .map(|value| serde_json::from_value(value.clone()).expect("declared kind"));
            let input = Path::new(case["input"].as_str().expect("input"));
            let expected: JobType = serde_json::from_value(case["kind"].clone()).expect("kind");
            assert_eq!(
                output_type(
                    Some(&preset),
                    input
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                ),
                expected,
                "{}",
                case["template"]
            );
            let policy = crate::ffui_core::domain::OutputPolicy {
                container: OutputContainerPolicy::ByMedia {
                    video: Some("mkv".into()),
                    audio: Some("mp3".into()),
                    image: Some("bmp".into()),
                },
                ..Default::default()
            };
            let plan = super::super::output_policy_paths::preview_video_output_path(
                input,
                Some(&preset),
                &policy,
            );
            assert_eq!(
                plan.output_path
                    .extension()
                    .and_then(|value| value.to_str()),
                case["extension"].as_str()
            );
            if let Some(expected) = case.get("defaultExtension") {
                let default_plan = super::super::output_policy_paths::preview_video_output_path(
                    input,
                    Some(&preset),
                    &crate::ffui_core::domain::OutputPolicy::default(),
                );
                assert_eq!(
                    default_plan
                        .output_path
                        .extension()
                        .and_then(|value| value.to_str()),
                    expected.as_str(),
                    "{}",
                    case["template"]
                );
            }
        }
    }
}
