import { ensureJobPreview, hasTauri } from "@/lib/backend";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

const pendingJobIds = new Set<string>();
const lastAttemptAtMsByJobId = new Map<string, number>();

let workerRunning = false;

const MIN_RETRY_MS = isTestEnv ? 0 : 15_000;
const YIELD_BETWEEN_JOBS_MS = isTestEnv ? 0 : 20;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runWorker() {
  try {
    while (pendingJobIds.size > 0) {
      const next = pendingJobIds.values().next().value as string | undefined;
      if (!next) {
        break;
      }
      pendingJobIds.delete(next);

      try {
        await ensureJobPreview(next);
      } catch {
        // Best-effort: backend errors are already logged there and UI will keep placeholder.
      }

      if (YIELD_BETWEEN_JOBS_MS > 0) {
        await sleep(YIELD_BETWEEN_JOBS_MS);
      }
    }
  } finally {
    workerRunning = false;
    if (pendingJobIds.size > 0) {
      workerRunning = true;
      void runWorker();
    }
  }
}

export function requestJobPreviewWarmup(jobId: string | null | undefined) {
  if (!hasTauri()) return;
  const normalized = (jobId ?? "").trim();
  if (!normalized) return;

  const now = Date.now();
  const last = lastAttemptAtMsByJobId.get(normalized);
  if (typeof last === "number" && now - last < MIN_RETRY_MS) {
    return;
  }
  lastAttemptAtMsByJobId.set(normalized, now);

  pendingJobIds.add(normalized);
  if (!workerRunning) {
    workerRunning = true;
    void runWorker();
  }
}

export function resetJobPreviewWarmupForTests() {
  if (!isTestEnv) return;
  pendingJobIds.clear();
  lastAttemptAtMsByJobId.clear();
  workerRunning = false;
}
