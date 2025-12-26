const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

const MAX_CACHED = 96;
const inflight = new Map<string, Promise<void>>();

function trimCacheIfNeeded() {
  if (inflight.size <= MAX_CACHED) return;
  const toRemove = inflight.size - MAX_CACHED;
  if (toRemove <= 0) return;

  const keys = inflight.keys();
  for (let i = 0; i < toRemove; i += 1) {
    const next = keys.next().value as string | undefined;
    if (!next) break;
    inflight.delete(next);
  }
}

export function preloadImage(url: string | null | undefined) {
  if (!url) return;
  if (url.startsWith("data:")) return;
  if (isTestEnv) return;
  if (typeof Image === "undefined") return;

  if (inflight.has(url)) return;

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    try {
      // Hint: don't block the main thread on decode even if the consumer forgets to opt in.
      // `decoding` is a best-effort hint and may be ignored by the browser.
      (img as HTMLImageElement).decoding = "async";
    } catch {
      // ignore
    }

    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;

    // Prefer decode() when available so future paints are less likely to stall.
    const decode = (img as HTMLImageElement).decode;
    if (typeof decode === "function") {
      decode.call(img).then(resolve).catch(resolve);
    }
  });

  inflight.set(url, promise);
  trimCacheIfNeeded();
}

export function resetPreloadCacheForTests() {
  if (!isTestEnv) return;
  inflight.clear();
}
