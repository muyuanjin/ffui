use super::*;

#[test]
fn build_ffmpeg_args_strips_leading_ffmpeg_program_and_tokenizes_quoted_args() {
    let mut preset = make_test_preset();
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some(
        "ffmpeg -i INPUT -map 0 -metadata \"title=My Title\" -c:v libx264 -crf 23 OUTPUT"
            .to_string(),
    );

    let input = PathBuf::from("C:/Videos/My Input.mp4");
    let output = PathBuf::from("C:/Videos/Out File.mp4");
    let args = build_ffmpeg_args(&preset, &input, &output, true, None);

    assert!(
        !args
            .iter()
            .any(|a| a.eq_ignore_ascii_case("ffmpeg") || a.ends_with("ffmpeg.exe")),
        "template args must not include a leading ffmpeg program token, got: {}",
        args.join(" ")
    );

    let idx_i = args
        .iter()
        .position(|a| a == "-i")
        .expect("args should contain -i");
    assert_eq!(
        args.get(idx_i + 1).map(String::as_str),
        Some("C:/Videos/My Input.mp4"),
        "INPUT placeholder must be replaced as a single argv token even when path contains spaces"
    );

    let idx_meta = args
        .iter()
        .position(|a| a == "-metadata")
        .expect("args should contain -metadata");
    assert_eq!(
        args.get(idx_meta + 1).map(String::as_str),
        Some("title=My Title"),
        "quoted metadata arg should stay a single token"
    );
}

#[test]
fn build_ffmpeg_args_strips_leading_ffmpeg_exe_path_program() {
    let mut preset = make_test_preset();
    preset.advanced_enabled = Some(true);
    preset.ffmpeg_template = Some(
        "\"C:/Program Files/FFmpeg/bin/ffmpeg.exe\" -hide_banner -i INPUT -map 0 -c:v libx264 -crf 23 OUTPUT"
            .to_string(),
    );

    let input = PathBuf::from("C:/Videos/In.mp4");
    let output = PathBuf::from("C:/Videos/Out.mp4");
    let args = build_ffmpeg_args(&preset, &input, &output, true, None);

    assert!(
        !args
            .iter()
            .any(|a| a.eq_ignore_ascii_case("ffmpeg") || a.ends_with("ffmpeg.exe")),
        "template args must not include a leading ffmpeg.exe program token, got: {}",
        args.join(" ")
    );

    assert!(
        args.iter().any(|a| a == "-i"),
        "template args should still contain -i after stripping the program token, got: {}",
        args.join(" ")
    );
}
