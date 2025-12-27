import * as backend from "@/lib/backend";

const MAX_CONCURRENCY = 1;
// Must be comfortably larger than the maximum number of concurrently rendered queue items
// (virtua buffer + grid/icon views) to avoid dropping "currently visible" preview requests.
const MAX_QUEUE = 128;

let inFlight = 0;
const queuedJobIds: string[] = [];
const enqueuedJobIds = new Set<string>();
const pendingPromiseByJobId = new Map<string, Promise<string | null>>();
const resolveByJobId = new Map<string, (path: string | null) => void>();

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
}
