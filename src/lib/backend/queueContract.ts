import type {
  WireJobCompareSources,
  WireQueueStartupHint,
  WireQueueState,
  WireQueueStateLite,
  WireQueueStateLiteDelta,
  WireTranscodeJob,
  WireTranscodeJobLite,
  WireTranscodeJobLiteDeltaPatch,
} from "./generated/queue-contracts";
import type {
  JobCompareOutput,
  JobCompareSources,
  JobLogLineLike,
  JobRun,
  ProgressPhase,
  ProgressPhaseTelemetry,
  QueueStartupHint,
  QueueState,
  QueueStateLite,
  QueueStateLiteDelta,
  TranscodeJob,
  TranscodeJobLite,
  TranscodeJobLiteDeltaPatch,
  TranscodeJobLitePreviewDelta,
  TranscodeJobLiteTelemetryDelta,
  WaitMetadata,
} from "@/types/queue";
import type { OutputPolicy } from "@/types/output-policy";

const optional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

const numberOr = (value: number | null | undefined, fallback = 0): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const mapOutputPolicy = (value: unknown): OutputPolicy | undefined => {
  return optional(value as OutputPolicy | null | undefined);
};

type WireProgressPhaseTelemetry = Partial<Record<keyof ProgressPhaseTelemetry, unknown>>;

const mapProgressPhaseTelemetry = (wire: WireProgressPhaseTelemetry): ProgressPhaseTelemetry => {
  return {
    progressPhase: optional(wire.progressPhase as ProgressPhase | null | undefined),
    phaseProgress: optional(wire.phaseProgress as number | null | undefined),
    phaseOutTimeSeconds: optional(wire.phaseOutTimeSeconds as number | null | undefined),
    phaseDurationSeconds: optional(wire.phaseDurationSeconds as number | null | undefined),
    phaseSpeed: optional(wire.phaseSpeed as number | null | undefined),
    phaseUpdatedAtMs: optional(wire.phaseUpdatedAtMs as number | null | undefined),
    phaseEtaMs: optional(wire.phaseEtaMs as number | null | undefined),
  };
};

const mapWaitMetadata = (wire: TranscodeJob["waitMetadata"] | null | undefined): WaitMetadata | undefined => {
  if (!wire) return undefined;
  return {
    lastProgressPercent: optional(wire.lastProgressPercent),
    processedWallMillis: optional(wire.processedWallMillis),
    processedSeconds: optional(wire.processedSeconds),
    targetSeconds: optional(wire.targetSeconds),
    progressEpoch: optional(wire.progressEpoch),
    lastProgressOutTimeSeconds: optional(wire.lastProgressOutTimeSeconds),
    lastProgressSpeed: optional(wire.lastProgressSpeed),
    lastProgressUpdatedAtMs: optional(wire.lastProgressUpdatedAtMs),
    lastProgressFrame: optional(wire.lastProgressFrame),
    tmpOutputPath: optional(wire.tmpOutputPath),
    segments: optional(wire.segments),
    segmentEndTargets: optional(wire.segmentEndTargets),
  };
};

const mapJobRuns = (runs: WireTranscodeJob["runs"] | undefined): JobRun[] | undefined => {
  if (!runs) return undefined;
  return runs.map((run) => ({
    command: run.command,
    logs: run.logs as JobLogLineLike[] | undefined,
    startedAtMs: optional(run.startedAtMs),
  }));
};

export const transcodeJobFromWire = (wire: WireTranscodeJob): TranscodeJob => {
  return {
    id: wire.id,
    filename: wire.filename,
    type: wire.type,
    source: wire.source,
    queueOrder: wire.queueOrder,
    originalSizeMB: numberOr(wire.originalSizeMB),
    originalCodec: optional(wire.originalCodec),
    presetId: wire.presetId,
    status: wire.status,
    progress: numberOr(wire.progress),
    startTime: optional(wire.startTime),
    endTime: optional(wire.endTime),
    processingStartedMs: optional(wire.processingStartedMs),
    elapsedMs: optional(wire.elapsedMs),
    outputSizeMB: optional(wire.outputSizeMB),
    logs: wire.logs as JobLogLineLike[] | undefined,
    skipReason: optional(wire.skipReason),
    inputPath: optional(wire.inputPath),
    createdTimeMs: optional(wire.createdTimeMs),
    modifiedTimeMs: optional(wire.modifiedTimeMs),
    outputPath: optional(wire.outputPath),
    outputPolicy: mapOutputPolicy(wire.outputPolicy),
    ffmpegCommand: optional(wire.ffmpegCommand),
    runs: mapJobRuns(wire.runs),
    mediaInfo: optional(wire.mediaInfo as TranscodeJob["mediaInfo"] | null | undefined),
    estimatedSeconds: optional(wire.estimatedSeconds),
    previewPath: optional(wire.previewPath),
    previewRevision: optional(wire.previewRevision),
    logTail: optional(wire.logTail),
    failureReason: optional(wire.failureReason),
    warnings: wire.warnings,
    batchId: optional(wire.batchId),
    waitMetadata: mapWaitMetadata(wire.waitMetadata as WaitMetadata | null | undefined),
  };
};

export const transcodeJobLiteFromWire = (wire: WireTranscodeJobLite): TranscodeJobLite => {
  return {
    id: wire.id,
    filename: wire.filename,
    type: wire.type,
    source: wire.source,
    queueOrder: wire.queueOrder,
    originalSizeMB: numberOr(wire.originalSizeMB),
    originalCodec: optional(wire.originalCodec),
    presetId: wire.presetId,
    status: wire.status,
    waitRequestPending: wire.waitRequestPending,
    progress: numberOr(wire.progress),
    startTime: optional(wire.startTime),
    endTime: optional(wire.endTime),
    processingStartedMs: optional(wire.processingStartedMs),
    elapsedMs: optional(wire.elapsedMs),
    outputSizeMB: optional(wire.outputSizeMB),
    inputPath: optional(wire.inputPath),
    createdTimeMs: optional(wire.createdTimeMs),
    modifiedTimeMs: optional(wire.modifiedTimeMs),
    outputPath: optional(wire.outputPath),
    outputPolicy: mapOutputPolicy(wire.outputPolicy),
    ffmpegCommand: optional(wire.ffmpegCommand),
    firstRunCommand: optional(wire.firstRunCommand),
    firstRunStartedAtMs: optional(wire.firstRunStartedAtMs),
    skipReason: optional(wire.skipReason),
    mediaInfo: optional(wire.mediaInfo as TranscodeJobLite["mediaInfo"] | null | undefined),
    estimatedSeconds: optional(wire.estimatedSeconds),
    previewPath: optional(wire.previewPath),
    previewRevision: optional(wire.previewRevision),
    logTail: optional(wire.logTail),
    failureReason: optional(wire.failureReason),
    warnings: wire.warnings,
    batchId: optional(wire.batchId),
    waitMetadata: mapWaitMetadata(wire.waitMetadata as WaitMetadata | null | undefined),
    ...mapProgressPhaseTelemetry(wire),
  };
};

export const queueStateFromWire = (wire: WireQueueState): QueueState => ({
  jobs: wire.jobs.map(transcodeJobFromWire),
});

export const queueStateLiteFromWire = (wire: WireQueueStateLite): QueueStateLite => ({
  ...(typeof wire.snapshotRevision === "number" ? { snapshotRevision: wire.snapshotRevision } : {}),
  ...(typeof wire.latestDeltaRevision === "number" ? { latestDeltaRevision: wire.latestDeltaRevision } : {}),
  jobs: wire.jobs.map(transcodeJobLiteFromWire),
});

const telemetryDeltaFromWire = (
  wire: WireTranscodeJobLiteDeltaPatch["telemetry"],
): TranscodeJobLiteTelemetryDelta | undefined => {
  if (!wire) return undefined;
  return {
    progressEpoch: optional(wire.progressEpoch),
    lastProgressOutTimeSeconds: optional(wire.lastProgressOutTimeSeconds),
    lastProgressSpeed: optional(wire.lastProgressSpeed),
    lastProgressUpdatedAtMs: optional(wire.lastProgressUpdatedAtMs),
    lastProgressFrame: optional(wire.lastProgressFrame),
    ...mapProgressPhaseTelemetry(wire),
  };
};

const previewDeltaFromWire = (
  wire: WireTranscodeJobLiteDeltaPatch["preview"],
): TranscodeJobLitePreviewDelta | undefined => {
  if (!wire) return undefined;
  return {
    previewPath: optional(wire.previewPath),
    previewRevision: optional(wire.previewRevision),
  };
};

export const deltaPatchFromWire = (wire: WireTranscodeJobLiteDeltaPatch): TranscodeJobLiteDeltaPatch => ({
  id: wire.id,
  status: optional(wire.status),
  processingStartedMs: optional(wire.processingStartedMs),
  progress: optional(wire.progress),
  telemetry: telemetryDeltaFromWire(wire.telemetry),
  elapsedMs: optional(wire.elapsedMs),
  preview: previewDeltaFromWire(wire.preview),
});

export const queueStateLiteDeltaFromWire = (wire: WireQueueStateLiteDelta): QueueStateLiteDelta => ({
  baseSnapshotRevision: wire.baseSnapshotRevision,
  deltaRevision: wire.deltaRevision,
  patches: wire.patches.map(deltaPatchFromWire),
});

export const jobCompareSourcesFromWire = (wire: WireJobCompareSources | null): JobCompareSources | null => {
  if (!wire) return null;
  return {
    jobId: wire.jobId,
    inputPath: wire.inputPath,
    output: wire.output as JobCompareOutput,
    maxCompareSeconds: wire.maxCompareSeconds,
  };
};

export const queueStartupHintFromWire = (wire: WireQueueStartupHint | null): QueueStartupHint | null => {
  if (!wire) return null;
  return {
    kind: wire.kind,
    autoPausedJobCount: wire.autoPausedJobCount,
  };
};
