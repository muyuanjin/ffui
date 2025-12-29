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

  const hasProgressTelemetry =
    (typeof patch.progressOutTimeSeconds === "number" && Number.isFinite(patch.progressOutTimeSeconds)) ||
    (typeof patch.progressSpeed === "number" && Number.isFinite(patch.progressSpeed)) ||
    (typeof patch.progressUpdatedAtMs === "number" && Number.isFinite(patch.progressUpdatedAtMs)) ||
    (typeof patch.progressEpoch === "number" && Number.isFinite(patch.progressEpoch));

  if (hasProgressTelemetry) {
    const meta = (job.waitMetadata ??= {});

    if (
      typeof patch.progressOutTimeSeconds === "number" &&
      Number.isFinite(patch.progressOutTimeSeconds) &&
      patch.progressOutTimeSeconds >= 0
    ) {
      meta.lastProgressOutTimeSeconds = patch.progressOutTimeSeconds;
    }
    if (typeof patch.progressSpeed === "number" && Number.isFinite(patch.progressSpeed) && patch.progressSpeed > 0) {
      meta.lastProgressSpeed = patch.progressSpeed;
    }
    if (
      typeof patch.progressUpdatedAtMs === "number" &&
      Number.isFinite(patch.progressUpdatedAtMs) &&
      patch.progressUpdatedAtMs >= 0
    ) {
      meta.lastProgressUpdatedAtMs = patch.progressUpdatedAtMs;
    }
    if (typeof patch.progressEpoch === "number" && Number.isFinite(patch.progressEpoch) && patch.progressEpoch >= 0) {
      meta.progressEpoch = patch.progressEpoch;
    }
  }

  if (typeof patch.elapsedMs === "number" && Number.isFinite(patch.elapsedMs) && patch.elapsedMs >= 0) {
    if (job.elapsedMs !== patch.elapsedMs) {
      job.elapsedMs = patch.elapsedMs;
      markVolatile();
    }
  }

  if (typeof patch.previewPath === "string") {
    if (job.previewPath !== patch.previewPath) {
      job.previewPath = patch.previewPath;
    }
  }

  if (
    typeof patch.previewRevision === "number" &&
    Number.isFinite(patch.previewRevision) &&
    patch.previewRevision >= 0
  ) {
    if (job.previewRevision !== patch.previewRevision) {
      job.previewRevision = patch.previewRevision;
    }
  }

  return { volatileSortUpdated };
}
