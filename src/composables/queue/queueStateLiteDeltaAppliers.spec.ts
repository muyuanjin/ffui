import { describe, it, expect } from "vitest";
import type { TranscodeJob, TranscodeJobLiteDeltaPatch } from "@/types";
import { applyDeltaPatchToJob } from "./queueStateLiteDeltaAppliers";

describe("queue state lite delta appliers", () => {
  it("applyDeltaPatchToJob applies grouped telemetry and preview patches", () => {
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

    const patch: TranscodeJobLiteDeltaPatch = {
      id: "job-1",
      status: "processing",
      processingStartedMs: 123_000,
      progress: 12.5,
      telemetry: {
        lastProgressOutTimeSeconds: 3.0,
        lastProgressSpeed: 1.25,
        lastProgressUpdatedAtMs: 1234,
        progressEpoch: 2,
        lastProgressFrame: 777,
        progressPhase: "muxing",
        phaseProgress: 25,
        phaseOutTimeSeconds: 15,
        phaseDurationSeconds: 60,
        phaseSpeed: 2,
        phaseUpdatedAtMs: 4321,
        phaseEtaMs: 22_500,
      },
      elapsedMs: 4567,
      preview: { previewPath: "C:/previews/job-1.jpg", previewRevision: 9 },
    };

    const volatileDirtyIds = new Set<string>();
    const result = applyDeltaPatchToJob(job, patch, { trackVolatileDirtyIds: true, volatileDirtyIds });

    expect(result.volatileSortUpdated).toBe(true);
    expect(volatileDirtyIds.has("job-1")).toBe(true);

    expect(job.status).toBe("processing");
    expect(job.processingStartedMs).toBe(123_000);
    expect(job.progress).toBe(12.5);
    expect(job.elapsedMs).toBe(4567);
    expect(job.previewPath).toBe("C:/previews/job-1.jpg");
    expect(job.previewRevision).toBe(9);

    expect(job.waitMetadata?.lastProgressOutTimeSeconds).toBe(3.0);
    expect(job.waitMetadata?.lastProgressSpeed).toBe(1.25);
    expect(job.waitMetadata?.lastProgressUpdatedAtMs).toBe(1234);
    expect(job.waitMetadata?.progressEpoch).toBe(2);
    expect(job.waitMetadata?.lastProgressFrame).toBe(777);
    expect(job.progressPhase).toBe("muxing");
    expect(job.phaseProgress).toBe(25);
    expect(job.phaseOutTimeSeconds).toBe(15);
    expect(job.phaseDurationSeconds).toBe(60);
    expect(job.phaseSpeed).toBe(2);
    expect(job.phaseUpdatedAtMs).toBe(4321);
    expect(job.phaseEtaMs).toBe(22_500);
  });

  it("applyDeltaPatchToJob applies skipped skipReason immediately", () => {
    const job: TranscodeJob = {
      id: "job-low-savings",
      filename: "C:/videos/job-low-savings.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 1,
      presetId: "preset-1",
      status: "processing",
      progress: 50,
    };

    const patch: TranscodeJobLiteDeltaPatch = {
      id: "job-low-savings",
      status: "skipped",
      progress: 100,
      skipReason: "Low savings (4.0%)",
    };

    applyDeltaPatchToJob(job, patch, { trackVolatileDirtyIds: false });

    expect(job.status).toBe("skipped");
    expect(job.progress).toBe(100);
    expect(job.skipReason).toBe("Low savings (4.0%)");
  });
});
