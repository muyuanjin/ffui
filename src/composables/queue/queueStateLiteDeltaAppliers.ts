import type { TranscodeJob, TranscodeJobLiteDeltaPatch } from "@/types";

export interface ApplyDeltaPatchOptions {
  trackVolatileDirtyIds: boolean;
  volatileDirtyIds?: Set<string>;
}

export interface ApplyDeltaPatchResult {
  volatileSortUpdated: boolean;
}

export function applyDeltaPatchToJob(
  job: TranscodeJob,
  patch: TranscodeJobLiteDeltaPatch,
  options: ApplyDeltaPatchOptions,
): ApplyDeltaPatchResult {
  const { trackVolatileDirtyIds, volatileDirtyIds } = options;
  const id = patch.id;

  let volatileSortUpdated = false;

  const markVolatile = () => {
    volatileSortUpdated = true;
    if (trackVolatileDirtyIds) volatileDirtyIds?.add(id);
  };

  if (typeof patch.status === "string" && patch.status !== job.status) {
    job.status = patch.status;
  }

  if (typeof patch.progress === "number" && Number.isFinite(patch.progress)) {
    const nextProgress = Math.min(100, Math.max(0, patch.progress));
    if (nextProgress !== job.progress) {
      job.progress = nextProgress;
      markVolatile();
    }
  }

  if (patch.telemetry && typeof patch.telemetry === "object") {
    const meta = (job.waitMetadata ??= {});
    Object.assign(meta, patch.telemetry);
  }

  if (typeof patch.elapsedMs === "number" && Number.isFinite(patch.elapsedMs) && patch.elapsedMs >= 0) {
    if (job.elapsedMs !== patch.elapsedMs) {
      job.elapsedMs = patch.elapsedMs;
      markVolatile();
    }
  }

  if (patch.preview && typeof patch.preview === "object") {
    Object.assign(job, patch.preview);
  }

  return { volatileSortUpdated };
}
