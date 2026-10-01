use serde::{Deserialize, Serialize};
use specta::Type;

use super::FFmpegPreset;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JobExecution {
    Video {
        #[specta(type = specta_typescript::Unknown)]
        preset: Box<FFmpegPreset>,
    },
    Ffmpeg {
        invocation: FfmpegInvocation,
    },
    Invalid {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInvocation {
    pub args: Vec<String>,
    pub working_directory: Option<String>,
    pub output: FfmpegOutput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<FfmpegProgress>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FfmpegProgress {
    InputDuration,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FfmpegOutput {
    ManagedFile {
        path: String,
        #[serde(rename = "argumentIndex")]
        argument_index: u32,
    },
    Transparent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobExecutionMode {
    Video,
    Managed,
    Transparent,
    Invalid,
}

impl JobExecution {
    pub fn mode(&self) -> JobExecutionMode {
        match self {
            Self::Video { .. } => JobExecutionMode::Video,
            Self::Ffmpeg { invocation } => match invocation.output {
                FfmpegOutput::ManagedFile { .. } => JobExecutionMode::Managed,
                FfmpegOutput::Transparent => JobExecutionMode::Transparent,
            },
            Self::Invalid { .. } => JobExecutionMode::Invalid,
        }
    }

    pub fn can_replay_automatically(&self) -> bool {
        matches!(
            self.mode(),
            JobExecutionMode::Video | JobExecutionMode::Managed
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegJobRequest {
    pub name: String,
    pub args: Vec<String>,
    pub working_directory: Option<String>,
}
