use super::*;

#[derive(serde::Deserialize)]
struct CommandContractCase {
    id: String,
    preset: FFmpegPreset,
    #[serde(rename = "expectedCommand")]
    expected_command: String,
}

#[derive(serde::Deserialize)]
struct CommandContractFixtures {
    cases: Vec<CommandContractCase>,
}

/// 确保后端 `build_ffmpeg_args` 与前端命令预览契约保持一致。
#[test]
fn build_ffmpeg_args_matches_frontend_contract_fixtures() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = std::path::Path::new(manifest_dir)
        .join("tests")
        .join("ffmpeg-command-contract.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|err| {
        panic!(
            "failed to read command contract fixtures at {}: {err}",
            path.display()
        )
    });

    let fixtures: CommandContractFixtures =
        serde_json::from_str(&raw).expect("command contract fixtures JSON must be valid");

    assert!(
        !fixtures.cases.is_empty(),
        "command contract fixtures must contain at least one case"
    );

    for case in fixtures.cases {
        assert!(
            !case.expected_command.is_empty(),
            "fixture {} must provide a non-empty expectedCommand",
            case.id
        );

        let input = std::path::Path::new("INPUT");
        let output = std::path::Path::new("OUTPUT");
        let args = build_ffmpeg_args(&case.preset, input, output, true, None);
        let joined = format!("ffmpeg {}", args.join(" "));

        assert_eq!(
            joined, case.expected_command,
            "Rust build_ffmpeg_args output must match frontend preview for case {}",
            case.id
        );
    }
}
