import type { VqResultsSnapshot } from "./types";
import { parseVqResultsDataJs } from "./parser";

const HOMEPAGE_URL = "https://rigaya.github.io/vq_results/";
const DATA_URL = "https://rigaya.github.io/vq_results/results/vq_results_data.js";

const CACHE_KEY = "ffui.vqResults.cache.v2";

let inFlight: Promise<VqResultsSnapshot> | null = null;
let lastFailureAtMs = 0;
let lastFailureMessage = "";

const safeJsonParse = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const extractTitle = (html: string): string | null => {
  const m = (html ?? "").match(/<title>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? null;
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
};

export const loadVqResultsSnapshot = async (options?: { refresh?: boolean }): Promise<VqResultsSnapshot> => {
  const refresh = options?.refresh === true;

  if (!refresh) {
    const now = Date.now();
    if (lastFailureAtMs > 0 && now - lastFailureAtMs < 10_000) {
      throw new Error(lastFailureMessage || "vq_results fetch recently failed");
    }
  }

  if (!refresh) {
    const cachedRaw = localStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      const cached = safeJsonParse<VqResultsSnapshot>(cachedRaw);
      if (cached && Array.isArray(cached.datasets) && cached.datasets.length > 0) {
        return cached;
      }
    }
  }

  if (!refresh && inFlight) {
    return await inFlight;
  }

  const task = (async () => {
    const [homeHtml, dataJs] = await Promise.all([fetchText(HOMEPAGE_URL), fetchText(DATA_URL)]);
    const datasets = parseVqResultsDataJs(dataJs);
    const snapshot: VqResultsSnapshot = {
      source: {
        homepageUrl: HOMEPAGE_URL,
        dataUrl: DATA_URL,
        title: extractTitle(homeHtml),
        fetchedAtIso: new Date().toISOString(),
      },
      datasets,
    };

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore quota errors; snapshot will still be kept in memory by callers.
    }

    return snapshot;
  })();

  inFlight = refresh ? null : task;
  try {
    const result = await task;
    lastFailureAtMs = 0;
    lastFailureMessage = "";
    return result;
  } catch (err: unknown) {
    lastFailureAtMs = Date.now();
    lastFailureMessage = err instanceof Error ? err.message : String(err ?? "Unknown error");
    throw err;
  } finally {
    if (inFlight === task) inFlight = null;
  }
};
