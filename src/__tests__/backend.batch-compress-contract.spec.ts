// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BatchCompressConfig } from "@/types";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>(async () => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => (payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload)),
  convertFileSrc: (path: string) => path,
}));

import { runAutoCompress } from "@/lib/backend";
import { IMAGE_EXTENSIONS } from "@/constants";

describe("backend batch compress contract", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("runAutoCompress passes canonical camelCase payload keys", async () => {
    const rootPath = "C:/media";
    const config: BatchCompressConfig = {
      replaceOriginal: true,
      minVideoSizeMB: 50,
      minImageSizeKB: 50,
      minAudioSizeKB: 500,
      savingConditionType: "absoluteSize",
      minSavingRatio: 0.95,
      minSavingAbsoluteMB: 5,
      imageTargetFormat: "webp",
      videoPresetId: "preset-1",
      videoFilter: { enabled: true, extensions: ["mp4"] },
      imageFilter: { enabled: true, extensions: ["jpg"] },
      audioFilter: { enabled: true, extensions: ["mp3"] },
      outputPolicy: {
        container: { mode: "keepInput" },
        directory: { mode: "fixed", directory: "D:/batch-compress-out" },
        filename: { suffix: ".compressed", appendTimestamp: true },
        preserveFileTimes: true,
      },
    };

    await runAutoCompress(rootPath, config);
    expect(invokeMock).toHaveBeenCalledWith("run_auto_compress", { rootPath, config });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("root_path");
  });

  it("default image extensions exclude gif and include avif", () => {
    expect(IMAGE_EXTENSIONS).toContain("avif");
    expect(IMAGE_EXTENSIONS).not.toContain("gif");
  });
});
