import { computed, ref, watch, type ComputedRef } from "vue";
import {
  buildJobPreviewUrl,
  cleanupFallbackPreviewFramesAsync,
  ensureJobPreview,
  hasTauri,
  loadPreviewDataUrl,
} from "@/lib/backend";
import { copyToClipboard } from "@/lib/copyToClipboard";
import type { FFmpegPreset, JobRun, TranscodeJob } from "@/types";
import { useFfmpegCommandView } from "@/components/queue-item/useFfmpegCommandView";
import { getJobCompareDisabledReason, isJobCompareEligible } from "@/lib/jobCompare";
import { invalidateJobPreviewAutoEnsure, requestJobPreviewAutoEnsure } from "@/components/queue-item/previewAutoEnsure";
import {
  formatJobLogLine,
  formatWallClockTimestamp,
  parseAndHighlightLog,
  parseAndHighlightLogTokens,
} from "@/composables/useJobLog";
import type { HighlightToken } from "@/lib/highlightTokens";
import { requestJobPreviewWarmup } from "@/lib/jobPreviewWarmup";
import { appendQueryParam } from "@/lib/url";

export type JobDetailDialogProps = {
  open: boolean;
  job: TranscodeJob | null;
  preset: FFmpegPreset | null;
  jobDetailLogText: string;
  highlightedLogHtml: string;
  /**
   * Resolved FFmpeg executable path from backend/tool status (if known).
   * Used to expand bare `ffmpeg` program tokens into the concrete path in
   * the "full command" view so users can copy the exact binary invocation.
   */
  ffmpegResolvedPath?: string | null;
};

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type DesiredHeightInput = number | null | undefined | { value: number | null | undefined };

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

export function useJobDetailDialogState(
  props: JobDetailDialogProps,
  t: TranslateFn,
  opts?: { desiredPreviewHeightPx?: DesiredHeightInput },
) {
  // --- Run selection (command + logs) ---
  const selectedCommandRun = ref("0");
  const selectedLogRun = ref("all"); // "all" | "0" | "1" | ...

  watch(
    () => props.job?.id,
    () => {
      selectedCommandRun.value = "0";
      selectedLogRun.value = "all";
    },
    { immediate: true },
  );

  const effectiveRuns = computed<JobRun[]>(() => {
    const job = props.job;
    if (!job) return [];
    if (Array.isArray(job.runs) && job.runs.length) return job.runs;

    const command = job.ffmpegCommand ?? "";
    const logs = Array.isArray(job.logs) ? job.logs : [];
    if (!command && !logs.length) return [];
    return [
      {
        command,
        logs,
      },
    ];
  });

  const selectedCommandRunIndex = computed(() => {
    const parsed = Number.parseInt(selectedCommandRun.value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  });

  const selectedLogRunIndex = computed<number | null>(() => {
    if (selectedLogRun.value === "all") return null;
    const parsed = Number.parseInt(selectedLogRun.value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  });

  // --- Preview handling ---
  const inlinePreviewUrl = ref<string | null>(null);
  const inlinePreviewFallbackLoaded = ref(false);
  const inlinePreviewRescreenshotAttempted = ref(false);
  const inlinePreviewVariantRetryAttempted = ref(false);
  let variantEnsureHandle: { promise: Promise<string | null>; cancel: () => void } | null = null;

  const desiredPreviewHeightPx = computed(() => {
    const raw = opts?.desiredPreviewHeightPx;
    const value = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
    const parsed = Math.floor(Number(value ?? 0));
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    // Keep a bounded set of tiers so caching remains effective.
    if (parsed <= 200) return 360;
    if (parsed <= 420) return 540;
    return 720;
  });

  watch(
    () => props.open,
    (open, prev) => {
      if (prev && !open && hasTauri()) {
        void cleanupFallbackPreviewFramesAsync();
      }
      if (prev && !open && variantEnsureHandle) {
        variantEnsureHandle.cancel();
        variantEnsureHandle = null;
      }
    },
  );

  watch(
    () => ({
      open: props.open,
      jobId: props.job?.id,
      type: props.job?.type,
      previewPath: props.job?.previewPath,
      previewRevision: props.job?.previewRevision,
      desiredHeightPx: desiredPreviewHeightPx.value,
    }),
    ({ open, jobId, type, previewPath, previewRevision, desiredHeightPx }) => {
      inlinePreviewFallbackLoaded.value = false;
      inlinePreviewRescreenshotAttempted.value = false;
      inlinePreviewVariantRetryAttempted.value = false;

      if (!open) {
        inlinePreviewUrl.value = null;
        if (variantEnsureHandle) {
          variantEnsureHandle.cancel();
          variantEnsureHandle = null;
        }
        return;
      }

      const baseUrl = previewPath ? buildJobPreviewUrl(previewPath, previewRevision) : null;
      inlinePreviewUrl.value = baseUrl;

      if (!jobId || type !== "video" || !hasTauri()) {
        if (!baseUrl && type === "video" && jobId) {
          requestJobPreviewWarmup(jobId);
        }
        return;
      }

      if (desiredHeightPx <= 0) {
        if (!baseUrl) {
          requestJobPreviewWarmup(jobId);
        }
        return;
      }

      if (variantEnsureHandle) {
        variantEnsureHandle.cancel();
        variantEnsureHandle = null;
      }
      const cacheKey = previewPath ? `${previewPath}|rev=${Number(previewRevision ?? 0)}` : null;
      variantEnsureHandle = requestJobPreviewAutoEnsure(jobId, { heightPx: desiredHeightPx, cacheKey });
      void variantEnsureHandle.promise.then((resolved) => {
        if (!resolved) return;
        if (!props.open) return;
        if (props.job?.id !== jobId) return;
        inlinePreviewUrl.value = buildJobPreviewUrl(resolved, props.job?.previewRevision);
      });
    },
    { immediate: true },
  );

  const handleInlinePreviewError = async () => {
    const path = props.job?.previewPath;
    if (!path) return;
    if (!hasTauri()) return;
    if (inlinePreviewFallbackLoaded.value) return;

    try {
      const jobId = props.job?.id;
      const heightPx = desiredPreviewHeightPx.value;
      if (jobId && props.job?.type === "video" && heightPx > 0 && !inlinePreviewVariantRetryAttempted.value) {
        inlinePreviewVariantRetryAttempted.value = true;
        const cacheKey = path ? `${path}|rev=${Number(props.job?.previewRevision ?? 0)}` : null;
        invalidateJobPreviewAutoEnsure(jobId, { heightPx, cacheKey });
        try {
          const handle = requestJobPreviewAutoEnsure(jobId, { heightPx, cacheKey });
          const regenerated = await handle.promise;
          if (regenerated && props.open && props.job?.id === jobId) {
            const url = buildJobPreviewUrl(regenerated, props.job?.previewRevision);
            inlinePreviewUrl.value = url ? appendQueryParam(url, "ffuiPreviewRetry", String(Date.now())) : null;
            inlinePreviewFallbackLoaded.value = false;
            return;
          }
        } catch {
          // fall back to base/data URL logic below
        }
      }

      inlinePreviewUrl.value = await loadPreviewDataUrl(path);
      inlinePreviewFallbackLoaded.value = true;
    } catch (error) {
      if (inlinePreviewRescreenshotAttempted.value || !props.job) {
        console.error("JobDetailDialog: failed to load inline preview via data URL fallback", error);
        return;
      }

      inlinePreviewRescreenshotAttempted.value = true;
      if (!isTestEnv) {
        console.warn("JobDetailDialog: preview missing or unreadable, attempting regeneration", error);
      }

      try {
        const regenerated = await ensureJobPreview(props.job.id);
        if (regenerated) {
          inlinePreviewUrl.value = buildJobPreviewUrl(regenerated, props.job.previewRevision);
          inlinePreviewFallbackLoaded.value = false;
        }
      } catch (regenError) {
        console.error("JobDetailDialog: failed to regenerate preview", regenError);
      }
    }
  };

  // --- Derived data ---
  const statusBadgeClass = computed(() => {
    if (!props.job) return "";
    const status = props.job.status;
    if (status === "completed") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
    if (status === "processing") return "bg-blue-500/20 text-blue-400 border-blue-500/40";
    if (status === "failed") return "bg-destructive/20 text-destructive border-destructive/40";
    if (status === "cancelled") return "bg-orange-500/20 text-orange-400 border-orange-500/40";
    if (status === "queued") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
    if (status === "paused") return "bg-purple-500/20 text-purple-400 border-purple-500/40";
    if (status === "skipped") return "bg-gray-500/20 text-gray-400 border-gray-500/40";
    return "bg-muted text-muted-foreground border-border";
  });

  const compareDisabledReason = computed(() => getJobCompareDisabledReason(props.job));
  const canCompare = computed(() => isJobCompareEligible(props.job) && compareDisabledReason.value == null);
  const compareDisabledText = computed(() => {
    const reason = compareDisabledReason.value;
    if (!reason) return null;
    if (reason === "not-video") return t("jobCompare.disabled.notVideo");
    if (reason === "status") return t("jobCompare.disabled.status");
    if (reason === "no-output") return t("jobCompare.disabled.noOutput");
    if (reason === "no-partial-output") return t("jobCompare.disabled.noPartialOutput");
    return t("jobCompare.disabled.unavailable");
  });

  const jobFileName = computed(() => {
    const path = props.job?.filename || "";
    if (!path) return "";
    const normalised = path.replace(/\\/g, "/");
    const idx = normalised.lastIndexOf("/");
    return idx >= 0 ? normalised.slice(idx + 1) : normalised;
  });

  const jobDetailRawCommand = computed(() => {
    const runs = effectiveRuns.value;
    const idx = selectedCommandRunIndex.value;
    return runs[idx]?.command || props.job?.ffmpegCommand || "";
  });

  const {
    effectiveCommand: jobDetailEffectiveCommand,
    hasDistinctTemplate: jobDetailHasDistinctTemplate,
    highlightedHtml: highlightedCommandHtml,
    highlightedTokens: highlightedCommandTokens,
    templateCommand: jobDetailTemplateCommand,
    toggle: toggleCommandView,
    toggleLabel: commandViewToggleLabel,
  } = useFfmpegCommandView({
    jobId: computed(() => props.job?.id),
    status: computed(() => props.job?.status),
    rawCommand: jobDetailRawCommand,
    ffmpegResolvedPath: computed(() => props.ffmpegResolvedPath),
    t: (key) => t(key),
  });

  const displayedLogText = computed(() => {
    const runs = effectiveRuns.value;
    const idx = selectedLogRunIndex.value;
    if (idx == null) {
      const lines: string[] = [];
      for (const run of runs) {
        if (run?.logs?.length) lines.push(...run.logs.map(formatJobLogLine));
      }
      return lines.length ? lines.join("\n") : props.jobDetailLogText || "";
    }

    const run = runs[idx];
    if (run?.logs?.length) return run.logs.map(formatJobLogLine).join("\n");

    // Best-effort fallback: if we don't have per-run logs, keep compatibility
    // by showing the aggregated logs for Run 1.
    if (idx === 0) return props.jobDetailLogText || "";
    return "";
  });

  const highlightedLogHtml = computed(() => parseAndHighlightLog(displayedLogText.value));
  const highlightedLogLines = computed(() => parseAndHighlightLogTokens(displayedLogText.value));

  // 任务耗时（秒）：优先使用后端累计的 elapsedMs（仅统计实际处理时间），
  // 若缺失则退回到 startTime/endTime 差值（近似总耗时），并在处理中时用当前时间估算。
  const jobProcessingSeconds = computed(() => {
    const job = props.job;
    if (!job) return null;

    // 1) 优先采用后端提供的累计处理时间（毫秒）
    if (job.elapsedMs != null && job.elapsedMs > 0 && Number.isFinite(job.elapsedMs)) {
      return job.elapsedMs / 1000;
    }

    // 2) 回退到基于开始/结束时间的近似值（优先使用 processingStartedMs）
    const fallbackStart = job.processingStartedMs ?? job.startTime;
    if (!fallbackStart) return null;
    const endMs = job.endTime ?? Date.now();
    if (endMs <= fallbackStart) return null;
    return (endMs - fallbackStart) / 1000;
  });

  const formatTimeOrDash = (ms: number | null | undefined): string => {
    return formatWallClockTimestamp(ms ?? null) ?? "-";
  };

  const jobStartedAtText = computed(() => {
    const job = props.job;
    if (!job) return "-";
    return formatTimeOrDash(job.processingStartedMs ?? job.startTime ?? null);
  });

  const jobQueuedAtText = computed(() => {
    const job = props.job;
    if (!job?.processingStartedMs || !job?.startTime) return null;
    if (job.startTime >= job.processingStartedMs) return null;
    return formatTimeOrDash(job.startTime);
  });

  const jobCompletedAtText = computed(() => {
    const job = props.job;
    if (!job) return "-";
    return formatTimeOrDash(job.endTime ?? null);
  });

  const unknownPresetLabel = computed(() => {
    const id = props.job?.presetId;
    if (!id) return "";
    const translated = t("taskDetail.unknownPreset", { id });
    if (translated && translated !== "taskDetail.unknownPreset") return translated;
    return `Unknown preset (${id})`;
  });

  const computedValues: Record<string, unknown> = {
    selectedCommandRun,
    selectedLogRun,
    effectiveRuns,
    inlinePreviewUrl,
    handleInlinePreviewError,
    copyToClipboard,
    statusBadgeClass,
    canCompare,
    compareDisabledText,
    jobFileName,
    jobDetailRawCommand,
    jobDetailEffectiveCommand,
    jobDetailHasDistinctTemplate,
    highlightedCommandHtml,
    highlightedCommandTokens,
    jobDetailTemplateCommand,
    toggleCommandView,
    commandViewToggleLabel,
    displayedLogText,
    highlightedLogHtml,
    highlightedLogLines,
    jobStartedAtText,
    jobQueuedAtText,
    jobCompletedAtText,
    jobProcessingSeconds,
    unknownPresetLabel,
  };

  return computedValues as {
    selectedCommandRun: typeof selectedCommandRun;
    selectedLogRun: typeof selectedLogRun;
    effectiveRuns: typeof effectiveRuns;
    inlinePreviewUrl: typeof inlinePreviewUrl;
    handleInlinePreviewError: typeof handleInlinePreviewError;
    copyToClipboard: typeof copyToClipboard;
    statusBadgeClass: typeof statusBadgeClass;
    canCompare: typeof canCompare;
    compareDisabledText: typeof compareDisabledText;
    jobFileName: typeof jobFileName;
    jobDetailRawCommand: typeof jobDetailRawCommand;
    jobDetailEffectiveCommand: ComputedRef<string>;
    jobDetailHasDistinctTemplate: ComputedRef<boolean>;
    highlightedCommandHtml: ComputedRef<string>;
    highlightedCommandTokens: ComputedRef<HighlightToken[]>;
    jobDetailTemplateCommand: ComputedRef<string | null>;
    toggleCommandView: () => void;
    commandViewToggleLabel: ComputedRef<string>;
    displayedLogText: ComputedRef<string>;
    highlightedLogHtml: ComputedRef<string>;
    highlightedLogLines: ComputedRef<import("@/composables/useJobLog").HighlightedLogLine[]>;
    jobStartedAtText: ComputedRef<string>;
    jobQueuedAtText: ComputedRef<string | null>;
    jobCompletedAtText: ComputedRef<string>;
    jobProcessingSeconds: ComputedRef<number | null>;
    unknownPresetLabel: ComputedRef<string>;
  };
}
