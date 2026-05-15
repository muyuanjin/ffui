import { describe, expect, it } from "vitest";
import type { TranscodeJob } from "@/types";
import { buildBatchPreviewSlots } from "./batchPreviewSlots";

const makeJob = (overrides: Partial<TranscodeJob>): TranscodeJob =>
  ({
    id: overrides.id ?? "job",
    filename: overrides.filename ?? "input.mp4",
    type: overrides.type ?? "video",
    status: overrides.status ?? "queued",
    progress: overrides.progress ?? 0,
    presetId: overrides.presetId ?? "preset",
    inputPath: overrides.inputPath,
    outputPath: overrides.outputPath,
    previewPath: overrides.previewPath,
    previewRevision: overrides.previewRevision,
    originalSizeMB: overrides.originalSizeMB ?? 0,
    source: overrides.source ?? "manual",
  }) as TranscodeJob;

describe("buildBatchPreviewSlots", () => {
  it("prefers previewable jobs, falls back to image paths, and pads placeholders", () => {
    const slots = buildBatchPreviewSlots([
      makeJob({ id: "video-no-preview", type: "video" }),
      makeJob({ id: "image-output", type: "image", outputPath: "out.jpg" }),
      makeJob({ id: "video-preview", previewPath: "preview.jpg", previewRevision: 7 }),
    ]);

    expect(slots).toHaveLength(9);
    expect(slots.slice(0, 3).map((slot) => slot.key)).toEqual(["image-output", "video-preview", "video-no-preview"]);
    expect(slots[0]?.previewPath).toBe("out.jpg");
    expect(slots[1]?.previewRevision).toBe(7);
    expect(slots.slice(3).every((slot) => slot.job == null && slot.previewPath == null)).toBe(true);
  });

  it("keeps each job in at most one preview slot", () => {
    const job = makeJob({ id: "same", previewPath: "preview.jpg" });
    const slots = buildBatchPreviewSlots([job, job], 2);

    expect(slots.map((slot) => slot.key)).toEqual(["same", "placeholder-1"]);
  });
});
