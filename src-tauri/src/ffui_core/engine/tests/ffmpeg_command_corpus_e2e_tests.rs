use super::*;

#[derive(serde::Deserialize)]
struct CorpusEntrySource {
    path: String,
    #[serde(rename = "lineStart")]
    line_start: usize,
}

#[derive(serde::Deserialize)]
struct CorpusEntry {
    id: String,
    source: CorpusEntrySource,
    kind: String,
    #[serde(rename = "normalizedBlock")]
    normalized_block: String,
    #[serde(rename = "argsOnlyTemplate")]
    args_only_template: Option<String>,
}

#[derive(serde::Deserialize)]
struct CorpusFixture {
    version: u32,
    entries: Vec<CorpusEntry>,
}

#[derive(serde::Deserialize)]
struct StrictCase {
    id: String,
    source: CorpusEntrySource,
    #[serde(rename = "argsOnlyTemplate")]
    args_only_template: String,
    #[serde(rename = "expectedArgv")]
    expected_argv: Vec<String>,
}

#[derive(serde::Deserialize)]
struct StrictFixture {
    version: u32,
    #[serde(rename = "inputPath")]
    input_path: String,
    #[serde(rename = "outputPath")]
    output_path: String,
    cases: Vec<StrictCase>,
}

#[derive(serde::Deserialize)]
struct MockCapturePayload {
    argv: Vec<String>,
}

fn read_json_fixture<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> T {
    let raw = std::fs::read_to_string(path).unwrap_or_else(|err| {
        panic!("failed to read JSON fixture at {}: {err}", path.display());
    });
    serde_json::from_str(&raw).unwrap_or_else(|err| {
        panic!("failed to parse JSON fixture at {}: {err}", path.display());
    })
}

fn locate_mock_ffmpeg_exe() -> std::path::PathBuf {
    fn is_mock_ffmpeg_exe(path: &std::path::Path) -> bool {
        if !path.is_file() {
            return false;
        }
        if cfg!(windows) {
            return path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("exe"));
        }
        // On Unix, cargo emits the binary without an extension, while sidecar artifacts
        // (e.g. dep-info `.d`) share the same prefix.
        path.extension().is_none()
    }

    fn find_in_dir(dir: &std::path::Path) -> Option<std::path::PathBuf> {
        let prefixes = ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"];
        let mut matches: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| prefixes.iter().any(|prefix| n.starts_with(prefix)))
            })
            .filter(|p| is_mock_ffmpeg_exe(p))
            .collect();
        matches.sort();
        matches.into_iter().next()
    }

    for key in [
        "CARGO_BIN_EXE_ffui-mock-ffmpeg",
        "CARGO_BIN_EXE_ffui_mock_ffmpeg",
    ] {
        if let Ok(path) = std::env::var(key)
            && !path.trim().is_empty()
        {
            let p = std::path::PathBuf::from(path);
            if p.exists() {
                return p;
            }
        }
    }

    // Prefer locating the mock binary next to the current test executable so we
    // work correctly with custom `--target-dir` and non-default profiles.
    if let Ok(current) = std::env::current_exe()
        && let Some(dir) = current.parent()
        && let Some(found) = find_in_dir(dir)
    {
        return found;
    }

    let crate_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let target_root = crate_root.join("target");
    let direct_candidates = if cfg!(windows) {
        ["ffui-mock-ffmpeg.exe", "ffui_mock_ffmpeg.exe"]
    } else {
        ["ffui-mock-ffmpeg", "ffui_mock_ffmpeg"]
    };

    for profile in ["check-all", "debug", "release"] {
        for exe_name in direct_candidates {
            let direct = target_root.join(profile).join(exe_name);
            if direct.exists() {
                return direct;
            }
        }

        let deps_dir = target_root.join(profile).join("deps");
        if deps_dir.exists()
            && let Some(found) = find_in_dir(&deps_dir)
        {
            return found;
        }
    }

    panic!("unable to locate mock ffmpeg executable in target/(check-all|debug|release)");
}

fn first_template_arg(args: &[String]) -> Option<&str> {
    if args.len() >= 2 && args[0] == "-progress" && args[1] == "pipe:2" {
        args.get(2).map(String::as_str)
    } else {
        args.first().map(String::as_str)
    }
}

fn assert_no_leading_program_token(args: &[String], context: &str) {
    let Some(first) = first_template_arg(args) else {
        panic!("{context}: argv must not be empty");
    };
    assert!(
        !first.eq_ignore_ascii_case("ffmpeg") && !first.to_lowercase().ends_with("ffmpeg.exe"),
        "{context}: argv must not start with a ffmpeg program token, got: {}",
        args.join(" ")
    );
}

fn assert_has_progress_pipe(args: &[String], context: &str) {
    assert!(
        args.windows(2)
            .any(|w| w[0] == "-progress" && w[1] == "pipe:2"),
        "{context}: argv must include `-progress pipe:2`, got: {}",
        args.join(" ")
    );
}

fn assert_placeholders_substituted(args: &[String], input: &str, output: &str, context: &str) {
    assert!(
        args.iter().any(|a| a == input),
        "{context}: argv must contain substituted input path {input:?}, argv={args:?}"
    );
    assert!(
        args.iter().any(|a| a == output),
        "{context}: argv must contain substituted output path {output:?}, argv={args:?}"
    );
    assert!(
        !args
            .iter()
            .any(|a| a.contains("INPUT") || a.contains("OUTPUT")),
        "{context}: argv must not contain literal placeholders, argv={args:?}"
    );
}

fn spawn_and_capture_argv(mock_exe: &std::path::Path, args: &[String]) -> Vec<String> {
    let dir = tempfile::tempdir().expect("create argv capture dir");
    let capture_path = dir.path().join("argv.json");

    let status = std::process::Command::new(mock_exe)
        .args(args)
        .env("FFUI_MOCK_FFMPEG_CAPTURE_PATH", &capture_path)
        .env("FFUI_MOCK_FFMPEG_EMIT_PROGRESS", "0")
        .status()
        .unwrap_or_else(|err| panic!("failed to spawn mock ffmpeg {}: {err}", mock_exe.display()));

    assert!(
        status.success(),
        "mock ffmpeg should exit successfully, status={status:?}"
    );

    let raw = std::fs::read_to_string(&capture_path).unwrap_or_else(|err| {
        panic!(
            "failed to read capture file {}: {err}",
            capture_path.display()
        )
    });
    let payload: MockCapturePayload =
        serde_json::from_str(&raw).expect("capture payload JSON must be valid");
    payload.argv
}

#[test]
fn custom_eligible_templates_spawn_mock_ffmpeg_with_argv_fidelity() {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_path = manifest_dir
        .join("tests")
        .join("ffmpeg-command-corpus.fixture.json");
    let strict_path = manifest_dir
        .join("tests")
        .join("ffmpeg-command-corpus.strict.json");

    let fixture: CorpusFixture = read_json_fixture(&fixture_path);
    let strict: StrictFixture = read_json_fixture(&strict_path);

    assert_eq!(fixture.version, 1, "unexpected corpus fixture version");
    assert_eq!(strict.version, 1, "unexpected strict fixture version");

    let mock_exe = locate_mock_ffmpeg_exe();

    let input = std::path::PathBuf::from("C:/FFUI Inputs/Input File.mp4");
    let output = std::path::PathBuf::from("C:/FFUI Outputs/Out File.mp4");
    let input_s = input.to_string_lossy().to_string();
    let output_s = output.to_string_lossy().to_string();

    let mut custom_entries: Vec<&CorpusEntry> = fixture
        .entries
        .iter()
        .filter(|e| e.kind != "nonFfmpeg")
        .filter(|e| {
            e.args_only_template
                .as_ref()
                .is_some_and(|s| !s.trim().is_empty())
        })
        .collect();
    custom_entries.sort_by(|a, b| a.id.cmp(&b.id));

    assert!(
        !custom_entries.is_empty(),
        "corpus fixture must include at least one custom-eligible entry"
    );

    for entry in custom_entries {
        let template = entry
            .args_only_template
            .as_ref()
            .expect("filtered to entries with args-only template");
        let mut preset = make_test_preset();
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(template.clone());

        let argv = build_ffmpeg_args(&preset, &input, &output, true, None);
        let context = format!(
            "entry {} ({}:{}) {}",
            entry.id, entry.source.path, entry.source.line_start, entry.normalized_block
        );

        assert_no_leading_program_token(&argv, &context);
        assert_has_progress_pipe(&argv, &context);
        assert!(
            argv.iter().any(|a| a == "-nostdin"),
            "{context}: argv must include -nostdin for non_interactive=true, got: {}",
            argv.join(" ")
        );
        assert_placeholders_substituted(&argv, &input_s, &output_s, &context);

        let captured = spawn_and_capture_argv(&mock_exe, &argv);
        assert_eq!(
            captured,
            argv,
            "{context}: captured argv must match exactly; got {}",
            captured.join(" ")
        );
    }

    let strict_by_id: std::collections::HashMap<String, &StrictCase> =
        strict.cases.iter().map(|c| (c.id.clone(), c)).collect();
    assert!(
        !strict_by_id.is_empty(),
        "strict corpus fixture must contain at least one case"
    );

    for (id, strict_case) in strict_by_id {
        let mut preset = make_test_preset();
        preset.advanced_enabled = Some(true);
        preset.ffmpeg_template = Some(strict_case.args_only_template.clone());

        let input = std::path::PathBuf::from(&strict.input_path);
        let output = std::path::PathBuf::from(&strict.output_path);
        let argv = build_ffmpeg_args(&preset, &input, &output, true, None);
        assert_eq!(
            argv, strict_case.expected_argv,
            "strict case {id} ({}:{}) must match expected argv exactly",
            strict_case.source.path, strict_case.source.line_start
        );
    }
}
