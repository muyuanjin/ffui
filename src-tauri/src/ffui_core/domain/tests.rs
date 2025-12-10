#[cfg(test)]
mod domain_contract_tests {
    use super::super::{
        job::*, preset::PresetStats, smart_scan::AutoCompressProgress,
        smart_scan::AutoCompressResult,
    };
    use serde_json::{Value, json};

    #[test]
    fn transcode_job_uses_stable_mb_field_names_and_aliases() {
        let job = TranscodeJob {
            id: "1".to_string(),
            filename: "video.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::Manual,
            queue_order: None,
            original_size_mb: 123.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Waiting,
            progress: 0.0,
            start_time: Some(1),
            end_time: Some(2),
            processing_started_ms: Some(10),
            elapsed_ms: Some(12345),
            output_size_mb: Some(45.0),
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/output.mp4".to_string()),
            ffmpeg_command: Some(
                "ffmpeg -i \"C:/videos/input.mp4\" -c:v libx264 -crf 23 OUTPUT".to_string(),
            ),
            media_info: Some(MediaInfo {
                duration_seconds: Some(120.5),
                width: Some(1920),
                height: Some(1080),
                frame_rate: Some(29.97),
                video_codec: Some("h264".to_string()),
                audio_codec: Some("aac".to_string()),
                size_mb: Some(700.0),
            }),
            estimated_seconds: Some(300.0),
            preview_path: Some("C:/app-data/previews/abc123.jpg".to_string()),
            log_tail: Some("last few lines".to_string()),
            failure_reason: Some("ffmpeg exited with non-zero status (exit code 1)".to_string()),
            batch_id: Some("auto-compress-batch-1".to_string()),
            wait_metadata: None,
        };

        let value = serde_json::to_value(&job).expect("serialize TranscodeJob");
        assert_eq!(
            value.get("originalSizeMB").and_then(Value::as_f64).unwrap(),
            123.0
        );
        assert!(value.get("originalSizeMb").is_none());

        assert_eq!(
            value.get("outputSizeMB").and_then(Value::as_f64).unwrap(),
            45.0
        );
        assert!(value.get("outputSizeMb").is_none());

        // New optional inspection fields must use stable camelCase names.
        assert_eq!(
            value
                .get("inputPath")
                .and_then(Value::as_str)
                .expect("inputPath present"),
            "C:/videos/input.mp4"
        );
        assert_eq!(
            value
                .get("outputPath")
                .and_then(Value::as_str)
                .expect("outputPath present"),
            "C:/videos/output.mp4"
        );
        assert_eq!(
            value
                .get("processingStartedMs")
                .and_then(Value::as_u64)
                .expect("processingStartedMs present"),
            10
        );
        assert_eq!(
            value
                .get("ffmpegCommand")
                .and_then(Value::as_str)
                .expect("ffmpegCommand present"),
            "ffmpeg -i \"C:/videos/input.mp4\" -c:v libx264 -crf 23 OUTPUT"
        );

        let media = value
            .get("mediaInfo")
            .and_then(Value::as_object)
            .expect("mediaInfo object");
        assert_eq!(
            media
                .get("durationSeconds")
                .and_then(Value::as_f64)
                .unwrap(),
            120.5
        );
        assert_eq!(media.get("width").and_then(Value::as_u64).unwrap(), 1920u64);
        assert_eq!(
            media.get("height").and_then(Value::as_u64).unwrap(),
            1080u64
        );
        assert_eq!(
            media.get("frameRate").and_then(Value::as_f64).unwrap(),
            29.97
        );
        assert_eq!(
            media.get("videoCodec").and_then(Value::as_str).unwrap(),
            "h264"
        );
        assert_eq!(
            media.get("audioCodec").and_then(Value::as_str).unwrap(),
            "aac"
        );
        assert_eq!(media.get("sizeMB").and_then(Value::as_f64).unwrap(), 700.0);

        assert_eq!(
            value
                .get("estimatedSeconds")
                .and_then(Value::as_f64)
                .expect("estimatedSeconds present"),
            300.0
        );

        assert_eq!(
            value
                .get("previewPath")
                .and_then(Value::as_str)
                .expect("previewPath present"),
            "C:/app-data/previews/abc123.jpg"
        );
        assert_eq!(
            value
                .get("logTail")
                .and_then(Value::as_str)
                .expect("logTail present"),
            "last few lines"
        );
        assert_eq!(
            value
                .get("failureReason")
                .and_then(Value::as_str)
                .expect("failureReason present"),
            "ffmpeg exited with non-zero status (exit code 1)"
        );
        assert_eq!(
            value
                .get("batchId")
                .and_then(Value::as_str)
                .expect("batchId present"),
            "auto-compress-batch-1"
        );

        // elapsedMs 字段用于追踪累计转码时间
        assert_eq!(
            value
                .get("elapsedMs")
                .and_then(Value::as_u64)
                .expect("elapsedMs present"),
            12345
        );

        // Legacy JSON using *Mb fields must still deserialize correctly.
        let legacy_json = json!({
            "id": "legacy",
            "filename": "legacy.mp4",
            "type": "video",
            "source": "manual",
            "originalSizeMb": 50.0,
            "originalCodec": "h264",
            "presetId": "preset-1",
            "status": "waiting",
            "progress": 0.0,
            "logs": [],
        });
        let decoded: TranscodeJob =
            serde_json::from_value(legacy_json).expect("deserialize legacy TranscodeJob");
        assert_eq!(decoded.original_size_mb, 50.0);
    }

    #[test]
    fn preset_stats_uses_stable_mb_field_names_and_aliases() {
        let stats = PresetStats {
            usage_count: 1,
            total_input_size_mb: 100.0,
            total_output_size_mb: 50.0,
            total_time_seconds: 10.0,
        };

        let value = serde_json::to_value(&stats).expect("serialize PresetStats");
        assert_eq!(
            value
                .get("totalInputSizeMB")
                .and_then(Value::as_f64)
                .unwrap(),
            100.0
        );
        assert!(value.get("totalInputSizeMb").is_none());

        assert_eq!(
            value
                .get("totalOutputSizeMB")
                .and_then(Value::as_f64)
                .unwrap(),
            50.0
        );
        assert!(value.get("totalOutputSizeMb").is_none());

        let legacy_json = json!({
            "usageCount": 2,
            "totalInputSizeMb": 200.0,
            "totalOutputSizeMb": 80.0,
            "totalTimeSeconds": 20.0,
        });
        let decoded: PresetStats =
            serde_json::from_value(legacy_json).expect("deserialize legacy PresetStats");
        assert_eq!(decoded.total_input_size_mb, 200.0);
        assert_eq!(decoded.total_output_size_mb, 80.0);
        assert_eq!(decoded.usage_count, 2);
        assert_eq!(decoded.total_time_seconds, 20.0);
    }

    #[test]
    fn auto_compress_result_uses_camel_case_batch_fields() {
        let job = TranscodeJob {
            id: "1".to_string(),
            filename: "video.mp4".to_string(),
            job_type: JobType::Video,
            source: JobSource::SmartScan,
            queue_order: None,
            original_size_mb: 10.0,
            original_codec: Some("h264".to_string()),
            preset_id: "preset-1".to_string(),
            status: JobStatus::Completed,
            progress: 100.0,
            start_time: Some(1),
            end_time: Some(2),
            processing_started_ms: None,
            elapsed_ms: None,
            output_size_mb: Some(5.0),
            logs: Vec::new(),
            skip_reason: None,
            input_path: Some("C:/videos/input.mp4".to_string()),
            output_path: Some("C:/videos/output.mp4".to_string()),
            ffmpeg_command: None,
            media_info: None,
            estimated_seconds: None,
            preview_path: None,
            log_tail: None,
            failure_reason: None,
            batch_id: Some("auto-compress-batch-1".to_string()),
            wait_metadata: None,
        };

        let result = AutoCompressResult {
            root_path: "C:/videos".to_string(),
            jobs: vec![job],
            total_files_scanned: 1,
            total_candidates: 1,
            total_processed: 1,
            batch_id: "auto-compress-batch-1".to_string(),
            started_at_ms: 100,
            completed_at_ms: 200,
        };

        let value = serde_json::to_value(&result).expect("serialize AutoCompressResult");
        assert_eq!(
            value
                .get("batchId")
                .and_then(Value::as_str)
                .expect("batchId present"),
            "auto-compress-batch-1"
        );
        assert_eq!(
            value
                .get("startedAtMs")
                .and_then(Value::as_u64)
                .expect("startedAtMs present"),
            100
        );
        assert_eq!(
            value
                .get("completedAtMs")
                .and_then(Value::as_u64)
                .expect("completedAtMs present"),
            200
        );
    }

    #[test]
    fn auto_compress_progress_uses_camel_case_fields() {
        let progress = AutoCompressProgress {
            root_path: "C:/videos".to_string(),
            total_files_scanned: 10,
            total_candidates: 4,
            total_processed: 2,
            batch_id: "auto-compress-batch-1".to_string(),
        };

        let value = serde_json::to_value(&progress).expect("serialize AutoCompressProgress");
        assert_eq!(
            value
                .get("rootPath")
                .and_then(Value::as_str)
                .expect("rootPath present"),
            "C:/videos"
        );
        assert_eq!(
            value
                .get("totalFilesScanned")
                .and_then(Value::as_u64)
                .expect("totalFilesScanned present"),
            10
        );
        assert_eq!(
            value
                .get("totalCandidates")
                .and_then(Value::as_u64)
                .expect("totalCandidates present"),
            4
        );
        assert_eq!(
            value
                .get("totalProcessed")
                .and_then(Value::as_u64)
                .expect("totalProcessed present"),
            2
        );
        assert_eq!(
            value
                .get("batchId")
                .and_then(Value::as_str)
                .expect("batchId present"),
            "auto-compress-batch-1"
        );
    }
}
