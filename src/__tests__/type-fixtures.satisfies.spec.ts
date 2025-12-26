import { describe, it, expect } from "vitest";
import type { AppSettings, TranscodeJob } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

const appSettingsFixture = {
  tools: { autoDownload: true, autoUpdate: true },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
} satisfies AppSettings;

const transcodeJobFixture = {
  id: "job-1",
  filename: "C:/videos/sample.mp4",
  type: "video",
  source: "manual",
  originalSizeMB: 10,
  presetId: "preset-1",
  status: "queued",
  progress: 0,
} satisfies TranscodeJob;

describe("type-level fixtures", () => {
  it("keeps AppSettings and TranscodeJob shapes aligned", () => {
    expect(appSettingsFixture.tools.autoDownload).toBe(true);
    expect(transcodeJobFixture.status).toBe("queued");
  });
});
