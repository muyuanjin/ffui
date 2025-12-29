import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FFmpegPreset } from "../types";

const invokeMock = vi.fn<(cmd: string, payload: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload: Record<string, unknown>) => invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

import { loadPresets, loadSmartDefaultPresets, savePresetOnBackend, deletePresetOnBackend } from "./backend";

describe("backend contract - presets", () => {
  beforeEach(() => {
    invokeMock.mockReset();
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

  it("loadSmartDefaultPresets calls get_smart_default_presets and returns the backend list unchanged", async () => {
    const presets: FFmpegPreset[] = [
      {
        id: "smart-hevc-fast",
        name: "H.265 Fast NVENC",
        description: "HEVC NVENC CQ 28, preset p5, keeps source resolution for quick web/share.",
        video: {
          encoder: "hevc_nvenc",
          rateControl: "cq",
          qualityValue: 28,
          preset: "p5",
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
      },
    ];

    invokeMock.mockResolvedValueOnce(presets);

    const result = await loadSmartDefaultPresets();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd] = invokeMock.mock.calls[0];
    expect(cmd).toBe("get_smart_default_presets");
    expect(result).toEqual(presets);
    expect(result[0]?.filters?.scale).toBeUndefined();
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
    expect(payload).not.toHaveProperty("preset_id");
    expect(result).toEqual(remaining);
  });
});
