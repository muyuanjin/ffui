import type { TranscodeJob, TranscodeJobLiteDeltaPatch } from "@/types";

const isTerminalStatus = (status: string): boolean =>
  status === "completed" || status === "failed" || status === "skipped" || status === "cancelled";

const phaseTelemetryKeys = [
  "progressPhase",
  "phaseProgress",
  "phaseOutTimeSeconds",
  "phaseDurationSeconds",
  "phaseSpeed",
  "phaseUpdatedAtMs",
  "phaseEtaMs",
] as const;

const waitMetadataTelemetryKeys = [
  "progressEpoch",
  "lastProgressOutTimeSeconds",
  "lastProgressSpeed",
  "lastProgressUpdatedAtMs",
  "lastProgressFrame",
] as const;

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
    if (isTerminalStatus(patch.status)) {
      delete job.waitMetadata;
    }
  }

  if (
    typeof patch.processingStartedMs === "number" &&
    Number.isFinite(patch.processingStartedMs) &&
    patch.processingStartedMs >= 0
  ) {
    if (job.processingStartedMs !== patch.processingStartedMs) {
      job.processingStartedMs = patch.processingStartedMs;
      markVolatile();
    }
  }

  if (typeof patch.progress === "number" && Number.isFinite(patch.progress)) {
    const nextProgress = Math.min(100, Math.max(0, patch.progress));
    if (nextProgress !== job.progress) {
      job.progress = nextProgress;
      markVolatile();
    }
  }

  if (patch.skipReason !== undefined) {
    if (typeof patch.skipReason === "string") {
      job.skipReason = patch.skipReason;
    } else if (patch.skipReason === null) {
      job.skipReason = undefined;
    }
  }

  if (patch.telemetry && typeof patch.telemetry === "object") {
    let touchedWaitMetadata = false;
    const meta = (job.waitMetadata ??= {});
    for (const key of waitMetadataTelemetryKeys) {
      const value = patch.telemetry[key];
      if (value !== undefined) {
        (meta as Record<string, unknown>)[key] = value;
        touchedWaitMetadata = true;
      }
    }
    if (!touchedWaitMetadata && Object.keys(meta).length === 0) {
      delete job.waitMetadata;
    }
    for (const key of phaseTelemetryKeys) {
      const value = patch.telemetry[key];
      if (value !== undefined) {
        (job as unknown as Record<string, unknown>)[key] = value;
      }
    }
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
