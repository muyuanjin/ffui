import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscodeJob, FFmpegPreset } from "../types";

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

import {
  enqueueTranscodeJob,
  loadPreviewDataUrl,
  loadPresets,
  savePresetOnBackend,
  deletePresetOnBackend,
} from "./backend";

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

  it("loadPresets calls get_presets and returns the backend list unchanged", async () => {
    const presets: FFmpegPreset[] = [
      {
        id: "p1",
        name: "Universal 1080p",
        description: "x264 Medium CRF 23. Standard for web.",
        video: {
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 23,
          preset: "medium",
        },
        audio: {
          codec: "copy",
        },
        filters: {
          scale: "-2:1080",
        },
        stats: {
          usageCount: 5,
          totalInputSizeMB: 2500,
          totalOutputSizeMB: 800,
          totalTimeSeconds: 420,
        },
      },
    ];

    invokeMock.mockResolvedValueOnce(presets);

    const result = await loadPresets();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd] = invokeMock.mock.calls[0];
    expect(cmd).toBe("get_presets");
    expect(result).toEqual(presets);
  });

  it("savePresetOnBackend sends save_preset with the preset payload and returns the updated list", async () => {
    const preset: FFmpegPreset = {
      id: "custom-1",
      name: "Custom Preset",
      description: "User defined preset",
      video: {
        encoder: "libx264",
        rateControl: "crf",
        qualityValue: 20,
        preset: "slow",
      },
      audio: {
        codec: "aac",
        bitrate: 192,
      },
      filters: {},
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    };

    const backendList: FFmpegPreset[] = [
      {
        id: "p1",
        name: "Universal 1080p",
        description: "x264 Medium CRF 23. Standard for web.",
        video: {
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 23,
          preset: "medium",
        },
        audio: {
          codec: "copy",
        },
        filters: {
          scale: "-2:1080",
        },
        stats: {
          usageCount: 5,
          totalInputSizeMB: 2500,
          totalOutputSizeMB: 800,
          totalTimeSeconds: 420,
        },
      },
      preset,
    ];

    invokeMock.mockResolvedValueOnce(backendList);

    const result = await savePresetOnBackend(preset);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("save_preset");
    expect(payload).toMatchObject({ preset });
    expect(result).toEqual(backendList);
  });

  it("savePresetOnBackend preserves extended video rate-control fields for VBR presets", async () => {
    const preset: FFmpegPreset = {
      id: "vbr-1",
      name: "VBR Test",
      description: "Preset with VBR + two-pass fields",
      video: {
        encoder: "libx264",
        rateControl: "vbr",
        qualityValue: 23,
        preset: "slow",
        bitrateKbps: 3000,
        maxBitrateKbps: 4500,
        bufferSizeKbits: 6000,
        pass: 2,
      },
      audio: {
        codec: "copy",
      },
      filters: {},
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    };

    const backendList: FFmpegPreset[] = [preset];
    invokeMock.mockResolvedValueOnce(backendList);

    const result = await savePresetOnBackend(preset);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("save_preset");

    const sentPreset = (payload as any).preset as FFmpegPreset;
    expect(sentPreset.video.rateControl).toBe("vbr");
    expect(sentPreset.video.bitrateKbps).toBe(3000);
    expect(sentPreset.video.maxBitrateKbps).toBe(4500);
    expect(sentPreset.video.bufferSizeKbits).toBe(6000);
    expect(sentPreset.video.pass).toBe(2);

    expect(result).toEqual(backendList);
  });

  it("deletePresetOnBackend sends delete_preset with the presetId and returns the updated list", async () => {
    const remaining: FFmpegPreset[] = [
      {
        id: "p1",
        name: "Universal 1080p",
        description: "x264 Medium CRF 23. Standard for web.",
        video: {
          encoder: "libx264",
          rateControl: "crf",
          qualityValue: 23,
          preset: "medium",
        },
        audio: {
          codec: "copy",
        },
        filters: {
          scale: "-2:1080",
        },
        stats: {
          usageCount: 5,
          totalInputSizeMB: 2500,
          totalOutputSizeMB: 800,
          totalTimeSeconds: 420,
        },
      },
    ];

    invokeMock.mockResolvedValueOnce(remaining);

    const result = await deletePresetOnBackend("custom-1");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invokeMock.mock.calls[0];
    expect(cmd).toBe("delete_preset");
    expect(payload).toMatchObject({ presetId: "custom-1" });
    expect(result).toEqual(remaining);
  });
});
