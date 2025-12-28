type Entry = { url: string; decodedAtMs: number };

const MAX_ENTRIES = 2048;
const TTL_MS = 10 * 60 * 1000;

// LRU: Map preserves insertion order.
const decodedByJobId = new Map<string, Entry>();

const nowMs = () => (typeof Date?.now === "function" ? Date.now() : new Date().getTime());

const isFresh = (entry: Entry): boolean => {
  const age = Math.max(0, nowMs() - entry.decodedAtMs);
  return age <= TTL_MS;
};

const touch = (jobId: string, entry: Entry) => {
  decodedByJobId.delete(jobId);
  decodedByJobId.set(jobId, entry);
};

export const markPreviewDecoded = (jobId: string, url: string) => {
  const safeJobId = (jobId ?? "").trim();
  const safeUrl = (url ?? "").trim();
  if (!safeJobId || !safeUrl) return;

  const entry: Entry = { url: safeUrl, decodedAtMs: nowMs() };
  decodedByJobId.set(safeJobId, entry);

  if (decodedByJobId.size <= MAX_ENTRIES) return;
  const overflow = decodedByJobId.size - MAX_ENTRIES;
  if (overflow <= 0) return;
  const keys = decodedByJobId.keys();
  for (let i = 0; i < overflow; i += 1) {
    const k = keys.next().value;
    if (!k) break;
    decodedByJobId.delete(k);
  }
};

export const getDecodedPreviewUrl = (jobId: string, expectedUrl: string): string | null => {
  const safeJobId = (jobId ?? "").trim();
  const safeUrl = (expectedUrl ?? "").trim();
  if (!safeJobId || !safeUrl) return null;

  const entry = decodedByJobId.get(safeJobId);
  if (!entry) return null;
  if (!isFresh(entry)) {
    decodedByJobId.delete(safeJobId);
    return null;
  }
  if (entry.url !== safeUrl) return null;
  touch(safeJobId, entry);
  return entry.url;
};

export const resetPreviewWarmCacheForTests = () => {
  decodedByJobId.clear();
};
