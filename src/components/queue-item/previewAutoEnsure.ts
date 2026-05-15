import * as backend from "@/lib/backend";

const MAX_TOTAL_CONCURRENCY = 2;
const MAX_NORMAL_CONCURRENCY_WITH_QUEUED_HIGH = 1;
const SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 2048;
const DEFAULT_HEIGHT_PX = 180;

let inFlightHigh = 0;
let inFlightNormal = 0;
const queuedHighKeys: string[] = [];
const queuedNormalKeys: string[] = [];
const queuedPriorityByKey = new Map<string, EnsurePriority>();
const resolvedPreviewPathByKey = new Map<string, { path: string; resolvedAtMs: number }>();
let scheduledPumpMode: ScheduleMode | null = null;
let scheduledPumpCancel: (() => void) | null = null;

const nowMs = () => (typeof Date?.now === "function" ? Date.now() : new Date().getTime());

const isCacheEntryFresh = (entry: { path: string; resolvedAtMs: number }): boolean => {
  const ageMs = Math.max(0, nowMs() - entry.resolvedAtMs);
  return ageMs <= SUCCESS_CACHE_TTL_MS;
};

const cacheResolvedPreviewPath = (key: string, path: string | null) => {
  if (!key) return;
  const safePath = (path ?? "").trim();
  if (!safePath) return;
  resolvedPreviewPathByKey.set(key, { path: safePath, resolvedAtMs: nowMs() });
  if (resolvedPreviewPathByKey.size <= MAX_CACHE) return;

  const overflow = resolvedPreviewPathByKey.size - MAX_CACHE;
  if (overflow <= 0) return;
  const keys = resolvedPreviewPathByKey.keys();
  for (let i = 0; i < overflow; i += 1) {
    const k = keys.next().value;
    if (!k) break;
    resolvedPreviewPathByKey.delete(k);
  }
};

type EnsurePriority = "high" | "normal";
type ScheduleMode = "eager" | "idle";

const clearScheduledPumpState = () => {
  scheduledPumpMode = null;
  scheduledPumpCancel = null;
};

const cancelScheduledPump = () => {
  const cancel = scheduledPumpCancel;
  clearScheduledPumpState();
  cancel?.();
};

const schedulePump = (priority: EnsurePriority) => {
  if (typeof window === "undefined") {
    pump();
    return;
  }

  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };

  const nextMode: ScheduleMode = priority === "high" ? "eager" : "idle";
  if (scheduledPumpMode === "eager") return;
  if (scheduledPumpMode === nextMode) return;

  cancelScheduledPump();

  const run = () => {
    clearScheduledPumpState();
    pump();
  };

  scheduledPumpMode = nextMode;

  if (nextMode === "eager") {
    const handle = window.setTimeout(run, 0);
    scheduledPumpCancel = () => {
      window.clearTimeout(handle);
    };
    return;
  }

  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(run, { timeout: 500 });
    scheduledPumpCancel = () => {
      if (typeof w.cancelIdleCallback === "function") {
        try {
          w.cancelIdleCallback(handle);
          return;
        } catch {
          // ignore
        }
      }
      window.clearTimeout(handle);
    };
    return;
  }

  if (typeof w.requestAnimationFrame === "function") {
    const handle = w.requestAnimationFrame(run);
    scheduledPumpCancel = () => {
      if (typeof w.cancelAnimationFrame === "function") {
        try {
          w.cancelAnimationFrame(handle);
          return;
        } catch {
          // ignore
        }
      }
      window.clearTimeout(handle);
    };
    return;
  }

  const handle = window.setTimeout(run, 0);
  scheduledPumpCancel = () => {
    window.clearTimeout(handle);
  };
};

type Consumer = {
  resolve: (path: string | null) => void;
  settled: boolean;
};

type JobOp = {
  state: "queued" | "running";
  priority: EnsurePriority;
  consumers: Map<number, Consumer>;
};

const jobOpsByKey = new Map<string, JobOp>();
let requestSeq = 0;

const hashCacheKey = (value: string): string => {
  // FNV-1a 32-bit, encoded as 8-char hex.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const removeFromQueue = (key: string) => {
  const priority = queuedPriorityByKey.get(key);
  if (!priority) return;
  queuedPriorityByKey.delete(key);

  const queue = priority === "high" ? queuedHighKeys : queuedNormalKeys;
  const idx = queue.indexOf(key);
  if (idx >= 0) queue.splice(idx, 1);
};

const enqueueKey = (key: string, priority: EnsurePriority) => {
  const existing = queuedPriorityByKey.get(key);
  if (existing === "high" || existing === priority) return;

  if (existing === "normal" && priority === "high") {
    const idx = queuedNormalKeys.indexOf(key);
    if (idx >= 0) queuedNormalKeys.splice(idx, 1);
  }

  queuedPriorityByKey.set(key, priority);
  if (priority === "high") {
    queuedHighKeys.push(key);
    return;
  }
  queuedNormalKeys.push(key);
};

const shiftQueuedKey = (queue: string[], priority: EnsurePriority): string | undefined => {
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate) continue;
    if (queuedPriorityByKey.get(candidate) !== priority) continue;
    queuedPriorityByKey.delete(candidate);
    return candidate;
  }
  return undefined;
};

const getNextQueuedPriority = (): EnsurePriority | null => {
  if (queuedHighKeys.length > 0) return "high";
  if (queuedNormalKeys.length > 0) return "normal";
  return null;
};

const scheduleQueuedPump = () => {
  const nextPriority = getNextQueuedPriority();
  if (!nextPriority) return;
  schedulePump(nextPriority);
};

const canStartPriority = (priority: EnsurePriority): boolean => {
  const totalInFlight = inFlightHigh + inFlightNormal;
  if (totalInFlight >= MAX_TOTAL_CONCURRENCY) return false;
  if (priority === "normal" && queuedHighKeys.length > 0 && inFlightNormal >= MAX_NORMAL_CONCURRENCY_WITH_QUEUED_HIGH) {
    return false;
  }
  return true;
};

const incrementInFlight = (priority: EnsurePriority) => {
  if (priority === "high") {
    inFlightHigh += 1;
    return;
  }
  inFlightNormal += 1;
};

const decrementInFlight = (priority: EnsurePriority) => {
  if (priority === "high") {
    inFlightHigh = Math.max(0, inFlightHigh - 1);
    return;
  }
  inFlightNormal = Math.max(0, inFlightNormal - 1);
};

const pump = () => {
  const startNext = (priority: EnsurePriority): boolean => {
    if (!canStartPriority(priority)) return false;

    let key: string | undefined;
    const queue = priority === "high" ? queuedHighKeys : queuedNormalKeys;
    while (true) {
      const candidate = shiftQueuedKey(queue, priority);
      if (!candidate) break;
      const op = jobOpsByKey.get(candidate);
      if (!op) continue;
      if (op.state !== "queued") continue;
      if (op.consumers.size === 0) {
        jobOpsByKey.delete(candidate);
        continue;
      }
      key = candidate;
      break;
    }
    if (!key) return false;

    const op = jobOpsByKey.get(key);
    if (!op || op.state !== "queued") return false;
    op.state = "running";

    const runningPriority = op.priority;
    incrementInFlight(runningPriority);

    let ensurePromise: Promise<string | null>;
    try {
      const [jobId, heightPartRaw] = key.split("|h=", 2);
      const heightPart = (heightPartRaw ?? "").split("|", 1)[0] ?? "";
      const parsedHeight = Number.parseInt(heightPart, 10);
      const heightPx = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : DEFAULT_HEIGHT_PX;

      const ensureJobPreview = (backend as any).ensureJobPreview as
        | undefined
        | ((id: string) => Promise<string | null>);
      const ensureJobPreviewVariant = (backend as any).ensureJobPreviewVariant as
        | undefined
        | ((id: string, heightPx: number) => Promise<string | null>);

      if (heightPx === DEFAULT_HEIGHT_PX) {
        ensurePromise = typeof ensureJobPreview === "function" ? ensureJobPreview(jobId) : Promise.resolve(null);
      } else {
        ensurePromise =
          typeof ensureJobPreviewVariant === "function"
            ? ensureJobPreviewVariant(jobId, heightPx)
            : Promise.resolve(null);
      }
    } catch {
      ensurePromise = Promise.resolve(null);
    }
    void ensurePromise
      .catch(() => null)
      .then((path) => {
        const resolvedPath = path ?? null;
        cacheResolvedPreviewPath(key, resolvedPath);
        const consumers = jobOpsByKey.get(key)?.consumers;
        if (consumers) {
          for (const c of consumers.values()) {
            if (c.settled) continue;
            c.settled = true;
            c.resolve(resolvedPath);
          }
        }
      })
      .finally(() => {
        jobOpsByKey.delete(key);
        decrementInFlight(runningPriority);
        scheduleQueuedPump();
      });

    return true;
  };

  let startedHigh = startNext("high");
  while (startedHigh) {
    startedHigh = startNext("high");
  }

  let startedNormal = startNext("normal");
  while (startedNormal) {
    startedNormal = startNext("normal");
  }
};

const normalizeHeightPx = (heightPx: number | null | undefined): number => {
  const parsed = Math.floor(Number(heightPx ?? DEFAULT_HEIGHT_PX));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HEIGHT_PX;
  return parsed;
};

const normalizeCacheKey = (cacheKey: string | null | undefined): string | null => {
  const trimmed = String(cacheKey ?? "").trim();
  if (!trimmed) return null;
  return trimmed;
};

const buildEnsureKey = (jobId: string, heightPx: number, cacheKey?: string | null): string => {
  const base = `${jobId}|h=${Math.max(1, heightPx)}`;
  const normalizedCacheKey = normalizeCacheKey(cacheKey);
  if (!normalizedCacheKey) return base;
  return `${base}|k=${hashCacheKey(normalizedCacheKey)}`;
};

export function invalidateJobPreviewAutoEnsure(
  jobId: string,
  opts?: { heightPx?: number | null; cacheKey?: string | null },
) {
  const normalizedJobId = String(jobId ?? "").trim();
  if (!normalizedJobId) return;
  const heightPx = normalizeHeightPx(opts?.heightPx);
  const key = buildEnsureKey(normalizedJobId, heightPx, opts?.cacheKey);
  resolvedPreviewPathByKey.delete(key);

  const op = jobOpsByKey.get(key);
  if (op?.state === "queued") {
    op.consumers.clear();
    jobOpsByKey.delete(key);
    removeFromQueue(key);
  }
}

export function requestJobPreviewAutoEnsure(
  jobId: string,
  opts?: { heightPx?: number | null; cacheKey?: string | null; priority?: EnsurePriority },
): { promise: Promise<string | null>; cancel: () => void } {
  if (!backend.hasTauri()) return { promise: Promise.resolve(null), cancel: () => {} };
  if (!jobId) return { promise: Promise.resolve(null), cancel: () => {} };

  const heightPx = normalizeHeightPx(opts?.heightPx);
  const key = buildEnsureKey(jobId, heightPx, opts?.cacheKey);
  const requestedPriority: EnsurePriority = opts?.priority === "high" ? "high" : "normal";

  const cached = resolvedPreviewPathByKey.get(key);
  if (cached && isCacheEntryFresh(cached)) {
    return { promise: Promise.resolve(cached.path), cancel: () => {} };
  }
  if (cached) {
    resolvedPreviewPathByKey.delete(key);
  }

  const requestId = (requestSeq = (requestSeq + 1) >>> 0);

  let op = jobOpsByKey.get(key);
  if (!op) {
    op = { state: "queued", priority: requestedPriority, consumers: new Map() };
    jobOpsByKey.set(key, op);
  } else if (op.state === "queued" && requestedPriority === "high" && op.priority !== "high") {
    op.priority = "high";
    enqueueKey(key, "high");
  }

  let resolveFn: (path: string | null) => void = () => {};
  const consumer: Consumer = {
    resolve: (path) => resolveFn(path),
    settled: false,
  };

  const promise = new Promise<string | null>((resolve) => {
    resolveFn = resolve;
  });

  op.consumers.set(requestId, consumer);

  if (op.state === "queued") {
    enqueueKey(key, op.priority);
    schedulePump(op.priority);
  }

  const cancel = () => {
    const current = jobOpsByKey.get(key);
    const c = current?.consumers.get(requestId);
    if (!c) return;
    current?.consumers.delete(requestId);
    if (!c.settled) {
      c.settled = true;
      c.resolve(null);
    }

    if (current && current.state === "queued" && current.consumers.size === 0) {
      jobOpsByKey.delete(key);
      removeFromQueue(key);
    }
  };

  return { promise, cancel };
}

export function ensureJobPreviewAuto(jobId: string): Promise<string | null> {
  return requestJobPreviewAutoEnsure(jobId).promise;
}

export function resetPreviewAutoEnsureForTests() {
  inFlightHigh = 0;
  inFlightNormal = 0;
  cancelScheduledPump();
  queuedHighKeys.length = 0;
  queuedNormalKeys.length = 0;
  queuedPriorityByKey.clear();
  jobOpsByKey.clear();
  requestSeq = 0;
  resolvedPreviewPathByKey.clear();
}

export function clearPreviewAutoEnsureCache() {
  resolvedPreviewPathByKey.clear();
}
