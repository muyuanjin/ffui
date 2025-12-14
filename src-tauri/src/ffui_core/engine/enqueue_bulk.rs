use crate::ffui_core::domain::{JobSource, JobType, TranscodeJob};

use super::TranscodingEngine;

impl TranscodingEngine {
    /// Enqueue multiple transcode jobs as a single batch.
    ///
    /// This avoids emitting and persisting a full queue snapshot per input,
    /// which can otherwise stall the UI when adding many jobs at once.
    pub fn enqueue_transcode_jobs(
        &self,
        filenames: Vec<String>,
        job_type: JobType,
        source: JobSource,
        original_size_mb: f64,
        original_codec: Option<String>,
        preset_id: String,
    ) -> Vec<TranscodeJob> {
        super::worker::enqueue_transcode_jobs(
            &self.inner,
            filenames,
            job_type,
            source,
            original_size_mb,
            original_codec,
            preset_id,
        )
    }
}
