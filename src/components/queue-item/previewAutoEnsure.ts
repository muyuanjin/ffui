import * as backend from "@/lib/backend";

const MAX_CONCURRENCY = 1;
const SUCCESS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 2048;
const DEFAULT_HEIGHT_PX = 180;

let inFlight = 0;
const queuedKeys: string[] = [];
const queuedKeySet = new Set<string>();
const resolvedPreviewPathByKey = new Map<string, { path: string; resolvedAtMs: number }>();

const nowMs = () => (typeof Date?.now === "function" ? Date.now() : new Date().getTime());

const isCacheEntryFresh = (entry: { path: string; resolvedAtMs: number }): boolean => {
  const ageMs = Math.max(0, nowMs() - entry.resolvedAtMs);
  return ageMs <= SUCCESS_CACHE_TTL_MS;
};

const cacheResolvedPreviewPath = (jobId: string, path: string | null) => {
  if (!jobId) return;
  const safePath = (path ?? "").trim();
  if (!safePath) return;
  resolvedPreviewPathByKey.set(jobId, { path: safePath, resolvedAtMs: nowMs() });
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

const jobOpsByKey = new Map<string, JobOp>();
let requestSeq = 0;

const removeFromQueue = (key: string) => {
  if (!queuedKeySet.has(key)) return;
  queuedKeySet.delete(key);
  const idx = queuedKeys.indexOf(key);
  if (idx >= 0) queuedKeys.splice(idx, 1);
};

const pump = () => {
  if (inFlight >= MAX_CONCURRENCY) return;
  let key: string | undefined;
  while (queuedKeys.length > 0) {
    const candidate = queuedKeys.shift();
    if (!candidate) break;
    queuedKeySet.delete(candidate);
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
  if (!key) return;

  const op = jobOpsByKey.get(key);
  if (!op || op.state !== "queued") return;
  op.state = "running";

  inFlight += 1;
  let ensurePromise: Promise<string | null>;
  try {
    const [jobId, heightPart] = key.split("|h=", 2);
    const parsedHeight = Number.parseInt(heightPart ?? "", 10);
    const heightPx = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : DEFAULT_HEIGHT_PX;

    const ensureJobPreview = (backend as any).ensureJobPreview as undefined | ((id: string) => Promise<string | null>);
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
      inFlight -= 1;
      schedule(pump);
    });
};

const normalizeHeightPx = (heightPx: number | null | undefined): number => {
  const parsed = Math.floor(Number(heightPx ?? DEFAULT_HEIGHT_PX));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HEIGHT_PX;
  return parsed;
};

const buildEnsureKey = (jobId: string, heightPx: number): string => {
  return `${jobId}|h=${Math.max(1, heightPx)}`;
};

export function requestJobPreviewAutoEnsure(
  jobId: string,
  opts?: { heightPx?: number | null },
): { promise: Promise<string | null>; cancel: () => void } {
  if (!backend.hasTauri()) return { promise: Promise.resolve(null), cancel: () => {} };
  if (!jobId) return { promise: Promise.resolve(null), cancel: () => {} };

  const heightPx = normalizeHeightPx(opts?.heightPx);
  const key = buildEnsureKey(jobId, heightPx);

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
    op = { state: "queued", consumers: new Map() };
    jobOpsByKey.set(key, op);
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

  if (op.state === "queued" && !queuedKeySet.has(key)) {
    queuedKeySet.add(key);
    queuedKeys.push(key);
    schedule(pump);
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
  inFlight = 0;
  queuedKeys.length = 0;
  queuedKeySet.clear();
  jobOpsByKey.clear();
  requestSeq = 0;
  resolvedPreviewPathByKey.clear();
}
