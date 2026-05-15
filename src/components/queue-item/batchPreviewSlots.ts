import type { TranscodeJob } from "@/types";

export type BatchPreviewSlot<TJob extends TranscodeJob = TranscodeJob> = {
  key: string;
  previewPath: string | null;
  previewRevision: number | null;
  job: TJob | null;
};

export function getEffectiveBatchJobPreviewPath(job: TranscodeJob): string | null {
  if (job.previewPath) return job.previewPath;
  if (job.type === "image") {
    return job.outputPath || job.inputPath || null;
  }
  return job.previewPath ?? null;
}

export function buildBatchPreviewSlots<TJob extends TranscodeJob>(
  jobs: readonly TJob[],
  limit = 9,
): BatchPreviewSlot<TJob>[] {
  const slots: BatchPreviewSlot<TJob>[] = [];
  const usedJobIds = new Set<string>();
  const jobsWithPreview: Array<{ job: TJob; previewPath: string }> = [];
  const jobsWithoutPreview: Array<{ job: TJob; previewPath: null }> = [];

  for (const job of jobs) {
    const previewPath = getEffectiveBatchJobPreviewPath(job);
    if (previewPath) {
      jobsWithPreview.push({ job, previewPath });
    } else {
      jobsWithoutPreview.push({ job, previewPath: null });
    }
  }

  const pushJobSlot = (source: { job: TJob; previewPath: string | null }) => {
    if (slots.length >= limit) return;
    const id = source.job.id;
    if (usedJobIds.has(id)) return;
    usedJobIds.add(id);

    slots.push({
      key: id,
      previewPath: source.previewPath,
      previewRevision: source.job.previewRevision ?? null,
      job: source.job,
    });
  };

  for (const source of jobsWithPreview) {
    if (slots.length >= limit) break;
    pushJobSlot(source);
  }

  for (const source of jobsWithoutPreview) {
    if (slots.length >= limit) break;
    pushJobSlot(source);
  }

  while (slots.length < limit) {
    const index = slots.length;
    slots.push({
      key: `placeholder-${index}`,
      previewPath: null,
      previewRevision: null,
      job: null,
    });
  }

  return slots;
}
