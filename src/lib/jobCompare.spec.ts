import { describe, it, expect } from "vitest";
import type { TranscodeJob } from "@/types";
import { getJobCompareDisabledReason, isJobCompareEligible } from "./jobCompare";

const baseJob: TranscodeJob = {
  id: "job-1",
  filename: "C:/videos/input.mp4",
  type: "video",
  source: "manual",
  originalSizeMB: 0,
  presetId: "preset-1",
  status: "waiting",
  progress: 0,
  logs: [],
};

describe("jobCompare eligibility", () => {
  it("is eligible only for video jobs in processing/paused/completed", () => {
    expect(isJobCompareEligible({ ...baseJob, status: "processing" })).toBe(true);
    expect(isJobCompareEligible({ ...baseJob, status: "paused" })).toBe(true);
    expect(isJobCompareEligible({ ...baseJob, status: "completed" })).toBe(true);

    expect(isJobCompareEligible({ ...baseJob, status: "waiting" })).toBe(false);
    expect(isJobCompareEligible({ ...baseJob, status: "queued" })).toBe(false);
    expect(isJobCompareEligible({ ...baseJob, status: "failed" })).toBe(false);
    expect(isJobCompareEligible({ ...baseJob, status: "cancelled" })).toBe(false);

    expect(isJobCompareEligible({ ...baseJob, type: "image", status: "completed" })).toBe(false);
  });

  it("surfaces disabled reasons for missing output sources", () => {
    expect(getJobCompareDisabledReason({ ...baseJob, type: "image" })).toBe("not-video");
    expect(getJobCompareDisabledReason({ ...baseJob, status: "waiting" })).toBe("status");
    expect(getJobCompareDisabledReason({ ...baseJob, status: "completed", outputPath: undefined })).toBe("no-output");
    expect(
      getJobCompareDisabledReason({
        ...baseJob,
        status: "paused",
        waitMetadata: { segments: [], tmpOutputPath: undefined },
      }),
    ).toBe("no-partial-output");

    expect(
      getJobCompareDisabledReason({
        ...baseJob,
        status: "paused",
        waitMetadata: { segments: ["C:/tmp/seg0.mkv"] },
      }),
    ).toBeNull();

    expect(
      getJobCompareDisabledReason({
        ...baseJob,
        status: "paused",
        waitMetadata: { tmpOutputPath: "C:/tmp/seg0.mkv" },
      }),
    ).toBeNull();
  });
});
