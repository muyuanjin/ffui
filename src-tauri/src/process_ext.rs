use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

pub(crate) fn run_command_with_timeout_capture_stderr(
    mut cmd: Command,
    timeout: Duration,
    stderr_capture_limit: usize,
) -> Result<(ExitStatus, bool, Vec<u8>), std::io::Error> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn()?;

    let mut stderr = child.stderr.take();
    let stderr_handle = std::thread::spawn(move || {
        let Some(mut stderr) = stderr.take() else {
            return Vec::<u8>::new();
        };

        let mut captured: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = match stderr.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            if captured.len() < stderr_capture_limit {
                let remaining = stderr_capture_limit - captured.len();
                let to_copy = remaining.min(n);
                captured.extend_from_slice(&buf[..to_copy]);
            }
        }
        captured
    });

    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() >= timeout {
            timed_out = true;
            drop(child.kill());
            break child.wait()?;
        }
        std::thread::sleep(Duration::from_millis(10));
    };

    let stderr_bytes = stderr_handle.join().unwrap_or_default();
    Ok((status, timed_out, stderr_bytes))
}
