use serde::{Deserialize, Serialize};

use crate::ffui_core::FallbackFrameQuality;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum JobCompareOutput {
    Completed {
        #[serde(rename = "outputPath")]
        output_path: String,
    },
    Partial {
        #[serde(rename = "segmentPaths")]
        segment_paths: Vec<String>,
        #[serde(rename = "activeSegmentPath", skip_serializing_if = "Option::is_none")]
        active_segment_path: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCompareSources {
    pub job_id: String,
    pub input_path: String,
    pub output: JobCompareOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_compare_seconds: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetJobCompareSourcesArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameQualityParam {
    Low,
    High,
}

impl From<FrameQualityParam> for FallbackFrameQuality {
    fn from(value: FrameQualityParam) -> Self {
        match value {
            FrameQualityParam::Low => Self::Low,
            FrameQualityParam::High => Self::High,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractJobCompareFrameArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
    #[serde(rename = "sourcePath", alias = "source_path")]
    pub source_path: String,
    #[serde(rename = "positionSeconds", alias = "position_seconds")]
    pub position_seconds: f64,
    #[serde(rename = "durationSeconds", alias = "duration_seconds")]
    pub duration_seconds: Option<f64>,
    pub quality: FrameQualityParam,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractJobCompareOutputFrameArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
    #[serde(rename = "positionSeconds", alias = "position_seconds")]
    pub position_seconds: f64,
    #[serde(rename = "durationSeconds", alias = "duration_seconds")]
    pub duration_seconds: Option<f64>,
    pub quality: FrameQualityParam,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractJobCompareConcatFrameArgs {
    #[serde(rename = "jobId", alias = "job_id")]
    pub job_id: String,
    #[serde(rename = "segmentPaths", alias = "segment_paths")]
    pub segment_paths: Vec<String>,
    #[serde(rename = "positionSeconds", alias = "position_seconds")]
    pub position_seconds: f64,
    pub quality: FrameQualityParam,
}
