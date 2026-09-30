use std::io::{BufRead, BufReader};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use anyhow::{Context, Result};

use crate::ffui_core::domain::FfmpegInvocation;

use super::super::ffmpeg_args::{assign_child_to_job, configure_background_command};

struct RunningChild(Child);

impl Drop for RunningChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            drop(self.0.kill());
            drop(self.0.wait());
        }
    }
}

pub(super) fn run(
    program: &str,
    invocation: &FfmpegInvocation,
    args: &[String],
    mut should_stop: impl FnMut() -> bool,
    mut on_line: impl FnMut(&str),
) -> Result<ExitStatus> {
    if should_stop() {
        anyhow::bail!("FFmpeg command stopped before launch");
    }
    let mut command = Command::new(program);
    configure_background_command(&mut command);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(directory) = &invocation.working_directory {
        command.current_dir(directory);
    }
    let mut child = RunningChild(command.spawn().context("failed to spawn FFmpeg command")?);
    assign_child_to_job(child.0.id());
    let stderr = child
        .0
        .stderr
        .take()
        .context("FFmpeg stderr was not connected")?;
    let (sender, receiver) = mpsc::sync_channel::<String>(64);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let result = (|| {
        loop {
            if should_stop() {
                drop(child.0.kill());
                break child.0.wait().context("failed to wait for stopped FFmpeg");
            }
            if let Some(status) = child.0.try_wait().context("failed to poll FFmpeg")? {
                break Ok(status);
            }
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(line) => on_line(&line),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(Duration::from_millis(20))
                }
            }
        }
    })();
    if result.is_err() {
        drop(child);
    }
    for line in receiver {
        on_line(&line);
    }
    drop(reader.join());
    result
}
