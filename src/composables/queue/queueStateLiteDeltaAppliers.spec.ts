import { describe, it, expect } from "vitest";
import type { TranscodeJob, TranscodeJobLiteDeltaPatch } from "@/types";
import { applyDeltaPatchToJob } from "./queueStateLiteDeltaAppliers";

type DeltaPatchKey = Exclude<keyof TranscodeJobLiteDeltaPatch, "id">;

type CompleteDeltaPatch = {
  id: string;
} & {
  [K in DeltaPatchKey]-?: NonNullable<TranscodeJobLiteDeltaPatch[K]>;
};

const readJobValueForPatchKey = {
  status: (job: TranscodeJob) => job.status,
  progress: (job: TranscodeJob) => job.progress,
  progressOutTimeSeconds: (job: TranscodeJob) => job.waitMetadata?.lastProgressOutTimeSeconds,
  progressSpeed: (job: TranscodeJob) => job.waitMetadata?.lastProgressSpeed,
  progressUpdatedAtMs: (job: TranscodeJob) => job.waitMetadata?.lastProgressUpdatedAtMs,
  progressEpoch: (job: TranscodeJob) => job.waitMetadata?.progressEpoch,
  elapsedMs: (job: TranscodeJob) => job.elapsedMs,
  previewPath: (job: TranscodeJob) => job.previewPath,
  previewRevision: (job: TranscodeJob) => job.previewRevision,
} as const satisfies Record<DeltaPatchKey, (job: TranscodeJob) => unknown>;

describe("queue state lite delta appliers", () => {
  it("applyDeltaPatchToJob applies every known patch field", () => {
    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/job-1.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 1,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      waitMetadata: undefined,
      elapsedMs: 0,
      previewPath: undefined,
      previewRevision: 0,
    };

    const patch: CompleteDeltaPatch = {
      id: "job-1",
      status: "processing",
      progress: 12.5,
      progressOutTimeSeconds: 3.0,
      progressSpeed: 1.25,
      progressUpdatedAtMs: 1234,
      progressEpoch: 2,
      elapsedMs: 4567,
      previewPath: "C:/previews/job-1.jpg",
      previewRevision: 9,
    };

    const volatileDirtyIds = new Set<string>();
    const result = applyDeltaPatchToJob(job, patch, { trackVolatileDirtyIds: true, volatileDirtyIds });

    expect(result.volatileSortUpdated).toBe(true);
    expect(volatileDirtyIds.has("job-1")).toBe(true);

    for (const key of Object.keys(readJobValueForPatchKey) as DeltaPatchKey[]) {
      const read = readJobValueForPatchKey[key];
      expect(read(job)).toEqual(patch[key]);
    }
  });
});
