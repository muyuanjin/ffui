import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscodeJob } from "../types";

const invokeMock = vi.fn<
  (cmd: string, payload: Record<string, unknown>) => Promise<unknown>
>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload: Record<string, unknown>) =>
      invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

import { enqueueTranscodeJob, loadPreviewDataUrl } from "./backend";

describe("backend contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends both camelCase and snake_case keys expected by the Rust command", async () => {
    const fakeJob: TranscodeJob = {
      id: "1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 0,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "waiting",
      progress: 0,
      logs: [],
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
      mediaInfo: {
        durationSeconds: 120.5,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        videoCodec: "h264",
        sizeMB: 700,
      },
      previewPath: "C:/app-data/previews/abc123.jpg",
      logTail: "ffmpeg exited with non-zero status (exit code 1)",
      failureReason: "ffmpeg exited with non-zero status (exit code 1)",
    };

    invokeMock.mockResolvedValueOnce(fakeJob);

    const result = await enqueueTranscodeJob({
      filename: fakeJob.filename,
      jobType: "video",
      source: "manual",
      originalSizeMb: 0,
      originalCodec: fakeJob.originalCodec,
      presetId: fakeJob.presetId,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];

    expect(cmd).toBe("enqueue_transcode_job");

    // Core identifiers
    expect(payload).toMatchObject({
      filename: fakeJob.filename,
      jobType: "video",
      job_type: "video",
      originalSizeMb: 0,
      original_size_mb: 0,
      originalCodec: fakeJob.originalCodec,
      original_codec: fakeJob.originalCodec,
      presetId: fakeJob.presetId,
      preset_id: fakeJob.presetId,
    });

    // Ensure the returned job is passed through unchanged.
    expect(result).toEqual(fakeJob);
  });

  it("loadPreviewDataUrl uses the dedicated preview command with both name variants", async () => {
    const previewPath = "C:/app-data/previews/abc123.jpg";
    const fakeUrl = "data:image/jpeg;base64,AAAA";

    invokeMock.mockResolvedValueOnce(fakeUrl);

    const result = await loadPreviewDataUrl(previewPath);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];

    expect(cmd).toBe("get_preview_data_url");
    expect(payload).toMatchObject({
      previewPath,
      preview_path: previewPath,
    });

    expect(result).toBe(fakeUrl);
  });
});
