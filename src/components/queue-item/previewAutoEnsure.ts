import * as backend from "@/lib/backend";

const MAX_CONCURRENCY = 1;
// Must be comfortably larger than the maximum number of concurrently rendered queue items
// (virtua buffer + grid/icon views) to avoid dropping "currently visible" preview requests.
const MAX_QUEUE = 128;
const SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 2048;

let inFlight = 0;
const queuedJobIds: string[] = [];
const enqueuedJobIds = new Set<string>();
const pendingPromiseByJobId = new Map<string, Promise<string | null>>();
const resolveByJobId = new Map<string, (path: string | null) => void>();
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

const pump = () => {
  if (inFlight >= MAX_CONCURRENCY) return;
  const jobId = queuedJobIds.shift();
  if (!jobId) return;
  enqueuedJobIds.delete(jobId);

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
      resolveByJobId.get(jobId)?.(resolvedPath);
    })
    .finally(() => {
      pendingPromiseByJobId.delete(jobId);
      resolveByJobId.delete(jobId);
      inFlight -= 1;
      schedule(pump);
    });
};

export function ensureJobPreviewAuto(jobId: string): Promise<string | null> {
  if (!backend.hasTauri()) return Promise.resolve(null);
  if (!jobId) return Promise.resolve(null);

  const cached = resolvedPreviewPathByJobId.get(jobId);
  if (cached && isCacheEntryFresh(cached)) {
    return Promise.resolve(cached.path);
  }
  if (cached) {
    resolvedPreviewPathByJobId.delete(jobId);
  }

  const existing = pendingPromiseByJobId.get(jobId);
  if (existing) return existing;

  let resolveFn: (path: string | null) => void = () => {};
  const promise = new Promise<string | null>((resolve) => {
    resolveFn = resolve;
  });
  pendingPromiseByJobId.set(jobId, promise);
  resolveByJobId.set(jobId, resolveFn);

  if (!enqueuedJobIds.has(jobId)) {
    enqueuedJobIds.add(jobId);
    queuedJobIds.push(jobId);
    if (queuedJobIds.length > MAX_QUEUE) {
      const dropped = queuedJobIds.shift();
      if (dropped) {
        enqueuedJobIds.delete(dropped);
        resolveByJobId.get(dropped)?.(null);
        pendingPromiseByJobId.delete(dropped);
        resolveByJobId.delete(dropped);
      }
    }
  }

  schedule(pump);

  return promise;
}

export function resetPreviewAutoEnsureForTests() {
  inFlight = 0;
  queuedJobIds.length = 0;
  enqueuedJobIds.clear();
  pendingPromiseByJobId.clear();
  resolveByJobId.clear();
  resolvedPreviewPathByJobId.clear();
}
