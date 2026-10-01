use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

pub(crate) fn run_command_with_timeout_capture_stderr(
    cmd: Command,
    timeout: Duration,
    stderr_capture_limit: usize,
) -> Result<(ExitStatus, bool, Vec<u8>), std::io::Error> {
    run_command_with_timeout_capture(cmd, timeout, stderr_capture_limit, false)
}

pub(crate) fn run_command_with_timeout_capture_stdout(
    cmd: Command,
    timeout: Duration,
    stdout_capture_limit: usize,
) -> Result<(ExitStatus, bool, Vec<u8>), std::io::Error> {
    run_command_with_timeout_capture(cmd, timeout, stdout_capture_limit, true)
}

fn run_command_with_timeout_capture(
    mut cmd: Command,
    timeout: Duration,
    capture_limit: usize,
    capture_stdout: bool,
) -> Result<(ExitStatus, bool, Vec<u8>), std::io::Error> {
    cmd.stdin(Stdio::null())
        .stdout(if capture_stdout {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stderr(if capture_stdout {
            Stdio::null()
        } else {
            Stdio::piped()
        });

    let mut child = cmd.spawn()?;

    let stream: Option<Box<dyn Read + Send>> = if capture_stdout {
        child
            .stdout
            .take()
            .map(|stream| Box::new(stream) as Box<dyn Read + Send>)
    } else {
        child
            .stderr
            .take()
            .map(|stream| Box::new(stream) as Box<dyn Read + Send>)
    };
    let capture_handle = std::thread::spawn(move || {
        let Some(mut stream) = stream else {
            return Vec::<u8>::new();
        };

        let mut captured: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            if captured.len() < capture_limit {
                let remaining = capture_limit - captured.len();
                let to_copy = remaining.min(n);
                captured.extend_from_slice(&buf[..to_copy]);
            }
        }
        captured
    });

    let start = Instant::now();
    let mut timed_out = false;
    let result = (|| loop {
        if let Some(status) = child.try_wait()? {
            break Ok(status);
        }
        if start.elapsed() >= timeout {
            timed_out = true;
            drop(child.kill());
            break child.wait();
        }
        std::thread::sleep(Duration::from_millis(10));
    })();
    if result.is_err() {
        drop(child.kill());
        drop(child.wait());
    }

    let captured_bytes = capture_handle.join().unwrap_or_default();
    Ok((result?, timed_out, captured_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(script: &str) -> Command {
        let mut command = Command::new(if cfg!(windows) { "cmd" } else { "/bin/sh" });
        command.args([if cfg!(windows) { "/c" } else { "-c" }, script]);
        command
    }

    #[test]
    fn capture_stdout_is_bounded_and_stderr_contract_is_preserved() {
        let (status, timed_out, stdout) = run_command_with_timeout_capture_stdout(
            shell("echo abcdef"),
            Duration::from_secs(5),
            3,
        )
        .expect("stdout");
        assert!(status.success() && !timed_out);
        assert_eq!(stdout, b"abc");
        let (status, timed_out, stderr) = run_command_with_timeout_capture_stderr(
            shell("echo diagnostic >&2"),
            Duration::from_secs(5),
            10,
        )
        .expect("stderr");
        assert!(status.success() && !timed_out);
        assert_eq!(stderr, b"diagnostic");
    }
}
