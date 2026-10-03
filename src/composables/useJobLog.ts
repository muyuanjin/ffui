import { computed, onScopeDispose, ref, type Ref, watch } from "vue";
import type { JobLogLineLike, TranscodeJob } from "@/types";
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

const pad2 = (v: number): string => String(v).padStart(2, "0");
const pad3 = (v: number): string => String(v).padStart(3, "0");

export function formatWallClockTimestamp(ms: number | null | undefined): string | null {
  const value = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(value) || value <= 0) return null;

  try {
    const d = new Date(value);
    const yyyy = d.getFullYear();
    const MM = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const mmm = pad3(d.getMilliseconds());
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}.${mmm}`;
  } catch {
    return null;
  }
}

export function formatJobLogLine(line: JobLogLineLike): string {
  if (typeof line === "string") return line;
  const text = typeof line?.text === "string" ? line.text : String((line as any)?.text ?? "");
  const ts = formatWallClockTimestamp(line?.atMs ?? null);
  return ts ? `[${ts}] ${text}` : text;
}

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
  jobDetailLogLoading: Ref<boolean>;
  jobDetailLogError: Ref<string | null>;
  jobDetailLogLoaded: Ref<boolean>;
  retryJobDetailLog: () => Promise<void>;
}

interface PendingHydration {
  started: boolean;
  promise: Promise<void>;
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
  const hydrationInFlightById = new Map<string, PendingHydration>();
  const hydrationRefreshPendingById = new Set<string>();
  onScopeDispose(() => hydrationRefreshPendingById.clear(), true);
  const loadStateById = ref<Record<string, { status: "loading" | "loaded" } | { status: "failed"; error: string }>>({});

  const maybeHydrateFromBackend = async (
    job: TranscodeJob | null,
    request?: { force?: boolean; refreshAfterPending?: boolean },
  ): Promise<void> => {
    if (!job) return;
    if (!hasTauri()) return;
    if (!job.id) return;
    if (!request?.force && hydratedDetailById.value[job.id]) return;
    const existingInFlight = hydrationInFlightById.get(job.id);
    if (existingInFlight) {
      if (request?.refreshAfterPending && existingInFlight.started) hydrationRefreshPendingById.add(job.id);
      return existingInFlight.promise;
    }

    loadStateById.value[job.id] = { status: "loading" };
    const inFlight: PendingHydration = {
      started: false,
      promise: Promise.resolve()
        .then(() => {
          inFlight.started = true;
          return loadJobDetail(job.id);
        })
        .then((full) => {
          if (!full) throw new Error("Job detail is unavailable");
          hydratedDetailById.value = { ...hydratedDetailById.value, [job.id]: full };
          loadStateById.value[job.id] = { status: "loaded" };
        })
        .catch((error: unknown) => {
          loadStateById.value[job.id] = {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        })
        .finally(() => {
          hydrationInFlightById.delete(job.id);
          const refreshRequested = hydrationRefreshPendingById.delete(job.id);
          const current = selectedJob.value;
          if (refreshRequested && options.detailOpen?.value && current?.id === job.id) {
            return maybeHydrateFromBackend(current, { force: true });
          }
        }),
    };
    hydrationInFlightById.set(job.id, inFlight);
    return inFlight.promise;
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
    ({ open, jobId, jobStatus, intervalMs }, previous, onCleanup) => {
      if (!hasTauri()) return;
      if (!open) return;
      if (!jobId) return;
      void maybeHydrateFromBackend(selectedJob.value, {
        force: true,
        refreshAfterPending:
          previous !== undefined && (!previous.open || previous.jobId !== jobId || previous.jobStatus !== jobStatus),
      });
      if (!jobStatus || TERMINAL_STATUSES.has(jobStatus)) return;

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
      if (Array.isArray(tailRaw)) {
        if (tailRaw.every((v) => typeof v === "string")) return (tailRaw as string[]).join("\n");
        return (tailRaw as JobLogLineLike[]).map(formatJobLogLine).join("\n");
      }
      return String(tailRaw);
    };

    const runLines: string[] = [];
    const runs = job.runs;
    if (Array.isArray(runs)) {
      for (const run of runs) {
        if (!run?.logs?.length) continue;
        runLines.push(...run.logs.map(formatJobLogLine));
      }
    }

    // In Tauri mode, always prefer the hydrated backend detail logs and never
    // treat queue-selected `job.logs` as authoritative (it may contain UI-only
    // optimistic messages or be incomplete).
    if (hasTauri() && job.id) {
      if (runLines.length) return runLines.join("\n");
      const full = job.logs?.length ? job.logs.map(formatJobLogLine).join("\n") : "";
      const tail = normalizeTail(job.logTail);
      return full || tail;
    }

    if (runLines.length) return runLines.join("\n");
    const full = job.logs?.length ? job.logs.map(formatJobLogLine).join("\n") : "";
    const tail = normalizeTail(job.logTail);
    return full || tail;
  });

  const highlightedLogHtml = computed<string>(() => {
    return parseAndHighlightLog(jobDetailLogText.value);
  });

  const selectedLoadState = computed(() => (selectedJob.value ? loadStateById.value[selectedJob.value.id] : undefined));
  const jobDetailLogLoading = computed(() => selectedLoadState.value?.status === "loading");
  const jobDetailLogError = computed(() =>
    selectedLoadState.value?.status === "failed" ? selectedLoadState.value.error : null,
  );
  const jobDetailLogLoaded = computed(() =>
    hasTauri() ? selectedLoadState.value?.status === "loaded" : selectedJob.value !== null,
  );
  const retryJobDetailLog = () => maybeHydrateFromBackend(selectedJob.value, { force: true });

  return {
    jobDetailLogText,
    jobDetailJob,
    highlightedLogHtml,
    jobDetailLogLoading,
    jobDetailLogError,
    jobDetailLogLoaded,
    retryJobDetailLog,
  };
}

export default useJobLog;
