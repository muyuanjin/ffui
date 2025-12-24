import { computed, ref, type Ref, watch } from "vue";
import type { TranscodeJob } from "@/types";
import { hasTauri, loadJobDetail } from "@/lib/backend";
import { parseAndHighlightLog } from "@/composables/jobLogHighlight";

export {
  type HighlightedLogLine,
  type LogLineEntry,
  type LogLineKind,
  classifyLogLine,
  flushStructuredProgressBlock,
  highlightFfmpegProgressLogLine,
  highlightFfmpegProgressLogLineTokens,
  logLineClass,
  parseAndHighlightLog,
  parseAndHighlightLogTokens,
  parseStructuredProgressPair,
  renderHighlightedLogLine,
  renderHighlightedLogLineTokens,
} from "@/composables/jobLogHighlight";

// ----- Composable -----

export interface UseJobLogOptions {
  /** The currently selected job for detail view. */
  selectedJob: Ref<TranscodeJob | null>;
  /**
   * Whether the job detail dialog is currently open.
   *
   * When open (Tauri mode) we periodically refresh the backend job detail so
   * multi-run logs (pause/resume cycles) keep updating in the UI.
   */
  detailOpen?: Ref<boolean>;
  /**
   * Poll interval for backend job detail refresh (milliseconds).
   * Defaults to 1000ms, clamped to [500ms, 5000ms] for stability.
   */
  pollIntervalMs?: number | Ref<number>;
}

export interface UseJobLogReturn {
  /** Raw log text from the selected job. */
  jobDetailLogText: Ref<string>;
  /** Effective job detail object (hydrated in Tauri mode when available). */
  jobDetailJob: Ref<TranscodeJob | null>;
  /** Highlighted HTML output for rendering in the UI. */
  highlightedLogHtml: Ref<string>;
}

/**
 * Composable for handling job log display and formatting.
 * Extracts log text from a selected job and produces highlighted HTML output.
 */
export function useJobLog(options: UseJobLogOptions): UseJobLogReturn {
  const { selectedJob } = options;

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "skipped"]);
  const getPollIntervalMs = (): number => {
    const raw = options.pollIntervalMs;
    const resolved = typeof raw === "number" ? raw : raw?.value;
    const parsed = typeof resolved === "number" ? resolved : Number(resolved);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1000;
    return Math.min(5000, Math.max(500, Math.round(parsed)));
  };

  // Full job detail (including complete logs) is intentionally fetched on-demand
  // for the task detail dialog. Queue snapshots (QueueStateLite) omit `logs` to
  // keep high-frequency updates cheap, so UI must not treat `selectedJob.logs`
  // as authoritative in Tauri mode.
  const hydratedDetailById = ref<Record<string, TranscodeJob | undefined>>({});
  const hydrationInFlightById = new Map<string, Promise<void>>();

  const maybeHydrateFromBackend = async (job: TranscodeJob | null, options?: { force?: boolean }) => {
    if (!job) return;
    if (!hasTauri()) return;
    if (!job.id) return;
    if (!options?.force && hydratedDetailById.value[job.id]) return;
    const existingInFlight = hydrationInFlightById.get(job.id);
    if (existingInFlight) {
      return;
    }

    try {
      const inFlight = (async () => {
        const full = await loadJobDetail(job.id);
        if (!full) return;
        hydratedDetailById.value = { ...hydratedDetailById.value, [job.id]: full };
      })();
      hydrationInFlightById.set(job.id, inFlight);
      await inFlight;
    } catch (error) {
      console.error("Failed to load job detail from backend", error);
    } finally {
      hydrationInFlightById.delete(job.id);
    }
  };

  watch(
    selectedJob,
    (job) => {
      void maybeHydrateFromBackend(job);
    },
    { immediate: true },
  );

  watch(
    () => ({
      open: options.detailOpen?.value ?? false,
      jobId: selectedJob.value?.id ?? null,
      jobStatus: selectedJob.value?.status ?? null,
      intervalMs: getPollIntervalMs(),
    }),
    ({ open, jobId, jobStatus, intervalMs }, _prev, onCleanup) => {
      if (!hasTauri()) return;
      if (!open) return;
      if (!jobId) return;
      if (!jobStatus || TERMINAL_STATUSES.has(jobStatus)) return;

      void maybeHydrateFromBackend(selectedJob.value, { force: true });

      const timer = setInterval(() => {
        const current = selectedJob.value;
        if (!current?.id) return;
        if (!current.status || TERMINAL_STATUSES.has(current.status)) return;
        void maybeHydrateFromBackend(current, { force: true });
      }, intervalMs);

      onCleanup(() => clearInterval(timer));
    },
    { immediate: true },
  );

  const jobDetailJob = computed<TranscodeJob | null>(() => {
    const job = selectedJob.value;
    if (!job) return null;
    if (!hasTauri() || !job.id) return job;

    const hydrated = hydratedDetailById.value[job.id] ?? null;
    if (!hydrated) return job;

    // Keep the queue-selected status/progress fields authoritative (they are
    // updated by high-frequency queue events), but merge heavyweight detail
    // fields (full logs/run history) from the backend detail response.
    return {
      ...job,
      ...hydrated,
      status: job.status,
      progress: job.progress,
      startTime: job.startTime,
      endTime: job.endTime,
      elapsedMs: job.elapsedMs ?? hydrated.elapsedMs,
      processingStartedMs: job.processingStartedMs ?? hydrated.processingStartedMs,
      warnings: job.warnings ?? hydrated.warnings,
    };
  });

  const jobDetailLogText = computed<string>(() => {
    const job = jobDetailJob.value;
    if (!job) return "";

    const normalizeTail = (tailRaw: unknown): string => {
      if (!tailRaw) return "";
      if (Array.isArray(tailRaw)) return tailRaw.join("\n");
      return String(tailRaw);
    };

    const runLines: string[] = [];
    const runs = job.runs;
    if (Array.isArray(runs)) {
      for (const run of runs) {
        if (run?.logs?.length) {
          runLines.push(...run.logs);
        }
      }
    }

    // In Tauri mode, always prefer the hydrated backend detail logs and never
    // treat queue-selected `job.logs` as authoritative (it may contain UI-only
    // optimistic messages or be incomplete).
    if (hasTauri() && job.id) {
      if (runLines.length) return runLines.join("\n");
      const full = job.logs?.length ? job.logs.join("\n") : "";
      const tail = normalizeTail(job.logTail);
      return full || tail;
    }

    if (runLines.length) return runLines.join("\n");
    const full = job.logs?.length ? job.logs.join("\n") : "";
    const tail = normalizeTail(job.logTail);
    return full || tail;
  });

  const highlightedLogHtml = computed<string>(() => {
    return parseAndHighlightLog(jobDetailLogText.value);
  });

  return {
    jobDetailLogText,
    jobDetailJob,
    highlightedLogHtml,
  };
}

export default useJobLog;
