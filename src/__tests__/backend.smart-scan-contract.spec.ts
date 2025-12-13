// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SmartScanConfig } from "@/types";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>(async () => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) =>
    payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload),
  convertFileSrc: (path: string) => path,
}));

import { runAutoCompress } from "@/lib/backend";

describe("backend smart scan contract", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("runAutoCompress passes both rootPath and root_path keys", async () => {
    const rootPath = "C:/media";
    const config: SmartScanConfig = {
      replaceOriginal: true,
      minVideoSizeMB: 50,
      minImageSizeKB: 50,
      minAudioSizeKB: 500,
      savingConditionType: "ratio",
      minSavingRatio: 0.95,
      minSavingAbsoluteMB: 5,
      imageTargetFormat: "avif",
      videoPresetId: "preset-1",
      videoFilter: { enabled: true, extensions: ["mp4"] },
      imageFilter: { enabled: true, extensions: ["jpg"] },
      audioFilter: { enabled: true, extensions: ["mp3"] },
    };

    await runAutoCompress(rootPath, config);
    expect(invokeMock).toHaveBeenCalledWith(
      "run_auto_compress",
      expect.objectContaining({ rootPath, root_path: rootPath, config }),
    );
  });
});
