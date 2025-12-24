use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
struct RevealCommand {
    program: String,
    args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RevealTarget {
    SelectFile(PathBuf),
    OpenDirectory(PathBuf),
}

fn normalize_reveal_target(path: &Path) -> Result<RevealTarget, String> {
    if path.as_os_str().is_empty() {
        return Err("path is empty".to_string());
    }

    if path.is_file() {
        return Ok(RevealTarget::SelectFile(path.to_path_buf()));
    }

    if path.is_dir() {
        return Ok(RevealTarget::OpenDirectory(path.to_path_buf()));
    }

    if let Some(parent) = path.parent()
        && parent.is_dir()
    {
        return Ok(RevealTarget::OpenDirectory(parent.to_path_buf()));
    }

    Err("path does not exist and has no accessible parent directory".to_string())
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn build_reveal_command(target: RevealTarget) -> RevealCommand {
    #[cfg(target_os = "windows")]
    {
        let program = "explorer.exe".to_string();
        let args = match target {
            // Use two separate arguments to avoid passing a pre-quoted string to
            // `explorer.exe`, which can cause the path to be ignored and the
            // shell to open the default Documents folder instead of selecting
            // the requested file.
            RevealTarget::SelectFile(path) => {
                vec!["/select,".to_string(), path.to_string_lossy().to_string()]
            }
            RevealTarget::OpenDirectory(path) => vec![path.to_string_lossy().to_string()],
        };
        RevealCommand { program, args }
    }

    #[cfg(target_os = "macos")]
    {
        let program = "open".to_string();
        let args = match target {
            RevealTarget::SelectFile(path) => vec!["-R".to_string(), path.to_string_lossy().into()],
            RevealTarget::OpenDirectory(path) => vec![path.to_string_lossy().to_string()],
        };
        RevealCommand { program, args }
    }

    #[cfg(target_os = "linux")]
    {
        let program = "xdg-open".to_string();
        let dir = match target {
            RevealTarget::SelectFile(path) => path.parent().unwrap_or(path.as_path()).to_path_buf(),
            RevealTarget::OpenDirectory(path) => path,
        };
        let dir_str = dir.to_string_lossy().to_string();
        RevealCommand {
            program,
            args: vec![dir_str],
        }
    }
}

#[cfg(not(test))]
fn execute_reveal_command(cmd: &RevealCommand) -> Result<(), String> {
    Command::new(&cmd.program)
        .args(&cmd.args)
        .spawn()
        .map_err(|e| format!("failed to launch file manager: {e}"))?;

    Ok(())
}

#[cfg(test)]
fn execute_reveal_command(_cmd: &RevealCommand) -> Result<(), String> {
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub(super) fn reveal_path_in_folder_impl(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is empty".to_string());
    }

    let normalized_target = normalize_reveal_target(Path::new(trimmed))?;
    let command = build_reveal_command(normalized_target);
    execute_reveal_command(&command)?;
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub(super) fn reveal_path_in_folder_impl(_path: String) -> Result<(), String> {
    Err("reveal_path_in_folder is not supported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_reveal_target_prefers_existing_file_selection() {
        let tmp = tempfile::NamedTempFile::new().expect("temp file must be created");
        let target = normalize_reveal_target(tmp.path()).expect("file path should be valid");

        match target {
            RevealTarget::SelectFile(path) => assert_eq!(path, tmp.path()),
            other => panic!("expected SelectFile, got {other:?}"),
        }
    }

    #[test]
    fn normalize_reveal_target_falls_back_to_parent_directory() {
        let dir = tempfile::tempdir().expect("temp dir must be created");
        let missing = dir.path().join("missing-output.mp4");

        let target = normalize_reveal_target(&missing).expect("missing file should fall back");
        match target {
            RevealTarget::OpenDirectory(path) => assert_eq!(path, dir.path()),
            other => panic!("expected OpenDirectory fallback, got {other:?}"),
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn build_reveal_command_uses_xdg_open_parent_directory() {
        let tmp = tempfile::NamedTempFile::new().expect("temp file must be created");
        let command = build_reveal_command(RevealTarget::SelectFile(tmp.path().to_path_buf()));

        assert_eq!(command.program, "xdg-open");
        assert_eq!(
            command.args,
            vec![
                tmp.path()
                    .parent()
                    .expect("temp file must have a parent directory")
                    .to_string_lossy()
                    .to_string()
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn build_reveal_command_splits_select_arg_on_windows() {
        let path = std::path::PathBuf::from(r"C:\\videos\\sample.mp4");
        let command = build_reveal_command(RevealTarget::SelectFile(path));

        assert_eq!(command.program, "explorer.exe");
        assert_eq!(
            command.args,
            vec![
                "/select,".to_string(),
                r"C:\\videos\\sample.mp4".to_string()
            ]
        );
    }

    #[test]
    fn reveal_path_in_folder_rejects_empty_input() {
        let result = reveal_path_in_folder_impl("".to_string());
        assert!(result.is_err(), "empty paths should be rejected");
    }
}
