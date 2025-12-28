import * as backend from "@/lib/backend";

const MAX_CONCURRENCY = 1;
const SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 2048;

let inFlight = 0;
const queuedJobIds: string[] = [];
const queuedJobIdSet = new Set<string>();
const resolvedPreviewPathByJobId = new Map<string, { path: string; resolvedAtMs: number }>();

const nowMs = () => (typeof Date?.now === "function" ? Date.now() : new Date().getTime());

const isCacheEntryFresh = (entry: { path: string; resolvedAtMs: number }): boolean => {
  const ageMs = Math.max(0, nowMs() - entry.resolvedAtMs);
  return ageMs <= SUCCESS_CACHE_TTL_MS;
};

const cacheResolvedPreviewPath = (jobId: string, path: string | null) => {
  if (!jobId) return;
  const safePath = (path ?? "").trim();
  if (!safePath) return;
  resolvedPreviewPathByJobId.set(jobId, { path: safePath, resolvedAtMs: nowMs() });
  if (resolvedPreviewPathByJobId.size <= MAX_CACHE) return;

  const overflow = resolvedPreviewPathByJobId.size - MAX_CACHE;
  if (overflow <= 0) return;
  const keys = resolvedPreviewPathByJobId.keys();
  for (let i = 0; i < overflow; i += 1) {
    const k = keys.next().value;
    if (!k) break;
    resolvedPreviewPathByJobId.delete(k);
  }
};

const schedule = (fn: () => void) => {
  if (typeof window === "undefined") {
    fn();
    return;
  }

  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    requestAnimationFrame?: (cb: () => void) => number;
  };

  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(fn, { timeout: 500 });
    return;
  }

  if (typeof w.requestAnimationFrame === "function") {
    w.requestAnimationFrame(fn);
    return;
  }

  window.setTimeout(fn, 0);
};

type Consumer = {
  resolve: (path: string | null) => void;
  settled: boolean;
};

type JobOp = {
  state: "queued" | "running";
  consumers: Map<number, Consumer>;
};

const jobOpsById = new Map<string, JobOp>();
let requestSeq = 0;

const removeFromQueue = (jobId: string) => {
  if (!queuedJobIdSet.has(jobId)) return;
  queuedJobIdSet.delete(jobId);
  const idx = queuedJobIds.indexOf(jobId);
  if (idx >= 0) queuedJobIds.splice(idx, 1);
};

const pump = () => {
  if (inFlight >= MAX_CONCURRENCY) return;
  let jobId: string | undefined;
  while (queuedJobIds.length > 0) {
    const candidate = queuedJobIds.shift();
    if (!candidate) break;
    queuedJobIdSet.delete(candidate);
    const op = jobOpsById.get(candidate);
    if (!op) continue;
    if (op.state !== "queued") continue;
    if (op.consumers.size === 0) {
      jobOpsById.delete(candidate);
      continue;
    }
    jobId = candidate;
    break;
  }
  if (!jobId) return;

  const op = jobOpsById.get(jobId);
  if (!op || op.state !== "queued") return;
  op.state = "running";

  inFlight += 1;
  let ensurePromise: Promise<string | null>;
  try {
    const ensureJobPreview = (backend as any).ensureJobPreview as undefined | ((id: string) => Promise<string | null>);
    ensurePromise = typeof ensureJobPreview === "function" ? ensureJobPreview(jobId) : Promise.resolve(null);
  } catch {
    ensurePromise = Promise.resolve(null);
  }
  void ensurePromise
    .catch(() => null)
    .then((path) => {
      const resolvedPath = path ?? null;
      cacheResolvedPreviewPath(jobId, resolvedPath);
      const consumers = jobOpsById.get(jobId)?.consumers;
      if (consumers) {
        for (const c of consumers.values()) {
          if (c.settled) continue;
          c.settled = true;
          c.resolve(resolvedPath);
        }
      }
    })
    .finally(() => {
      jobOpsById.delete(jobId);
      inFlight -= 1;
      schedule(pump);
    });
};

export function requestJobPreviewAutoEnsure(jobId: string): { promise: Promise<string | null>; cancel: () => void } {
  if (!backend.hasTauri()) return { promise: Promise.resolve(null), cancel: () => {} };
  if (!jobId) return { promise: Promise.resolve(null), cancel: () => {} };

  const cached = resolvedPreviewPathByJobId.get(jobId);
  if (cached && isCacheEntryFresh(cached)) {
    return { promise: Promise.resolve(cached.path), cancel: () => {} };
  }
  if (cached) {
    resolvedPreviewPathByJobId.delete(jobId);
  }

  const requestId = (requestSeq = (requestSeq + 1) >>> 0);

  let op = jobOpsById.get(jobId);
  if (!op) {
    op = { state: "queued", consumers: new Map() };
    jobOpsById.set(jobId, op);
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

  if (op.state === "queued" && !queuedJobIdSet.has(jobId)) {
    queuedJobIdSet.add(jobId);
    queuedJobIds.push(jobId);
    schedule(pump);
  }

  const cancel = () => {
    const current = jobOpsById.get(jobId);
    const c = current?.consumers.get(requestId);
    if (!c) return;
    current?.consumers.delete(requestId);
    if (!c.settled) {
      c.settled = true;
      c.resolve(null);
    }

    if (current && current.state === "queued" && current.consumers.size === 0) {
      jobOpsById.delete(jobId);
      removeFromQueue(jobId);
    }
  };

  return { promise, cancel };
}

export function ensureJobPreviewAuto(jobId: string): Promise<string | null> {
  return requestJobPreviewAutoEnsure(jobId).promise;
}

export function resetPreviewAutoEnsureForTests() {
  inFlight = 0;
  queuedJobIds.length = 0;
  queuedJobIdSet.clear();
  jobOpsById.clear();
  requestSeq = 0;
  resolvedPreviewPathByJobId.clear();
}
