// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>(async () => true);

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import { downloadVmafSampleVideo, measurePresetVmaf } from "@/lib/backend";

describe("backend preset VMAF contracts", () => {
  beforeEach(() => {
    (window as any).__TAURI_INTERNALS__ = {};
    invokeMock.mockReset();
  });

  it("calls download_vmaf_sample_video with stable keys", async () => {
    await downloadVmafSampleVideo("bbb1080p30s");
    expect(invokeMock).toHaveBeenCalledWith("download_vmaf_sample_video", { sampleId: "bbb1080p30s" });
  });

  it("calls measure_preset_vmaf with stable keys", async () => {
    await measurePresetVmaf("smart-hevc-fast", "C:/ref.mp4", { trimSeconds: 10 });
    expect(invokeMock).toHaveBeenCalledWith("measure_preset_vmaf", {
      presetId: "smart-hevc-fast",
      referencePath: "C:/ref.mp4",
      trimSeconds: 10,
    });
  });

  it("normalizes trimSeconds to null when invalid", async () => {
    await measurePresetVmaf("smart-hevc-fast", "C:/ref.mp4", { trimSeconds: 0 });
    expect(invokeMock).toHaveBeenCalledWith("measure_preset_vmaf", {
      presetId: "smart-hevc-fast",
      referencePath: "C:/ref.mp4",
      trimSeconds: null,
    });
  });
});
