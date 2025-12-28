import { describe, it, expect } from "vitest";
import type { TranscodeJob } from "@/types";
import { isWaitRequestPending, resolveUiJobStatus } from "./useMainAppQueue.pausing";

const makeJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
  id,
  filename: `C:/videos/${id}.mp4`,
  type: "video",
  source: "manual",
  originalSizeMB: 1,
  presetId: "preset-1",
  status,
  progress: 0,
  logs: [],
});

describe("resolveUiJobStatus", () => {
  it("treats processing + waitRequestPending as UI pausing", () => {
    const job: TranscodeJob = { ...makeJob("job-1", "processing"), waitRequestPending: true };
    expect(isWaitRequestPending(job)).toBe(true);
    expect(resolveUiJobStatus(job)).toBe("pausing");
  });

  it("treats processing without waitRequestPending as processing", () => {
    const job: TranscodeJob = makeJob("job-1", "processing");
    expect(isWaitRequestPending(job)).toBe(false);
    expect(resolveUiJobStatus(job)).toBe("processing");
  });

  it("never reports pausing for non-processing statuses", () => {
    const job: TranscodeJob = { ...makeJob("job-1", "paused"), waitRequestPending: true };
    expect(isWaitRequestPending(job)).toBe(false);
    expect(resolveUiJobStatus(job)).toBe("paused");
  });
});
