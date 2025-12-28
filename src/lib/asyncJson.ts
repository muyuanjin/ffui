import type { HighlightToken } from "@/lib/highlightTokens";
import type { ParsedMediaAnalysis } from "@/lib/mediaInfo";
import { parseFfprobeJson } from "@/lib/mediaInfo";
import { highlightJsonTokens } from "@/lib/jsonHighlight";

type WorkerOp = "parseJson" | "stringifyJson" | "parseFfprobeLite" | "highlightJsonTokens";

type WorkerRequest =
  | { id: number; op: "parseJson"; raw: string }
  | { id: number; op: "stringifyJson"; value: unknown; space?: number }
  | { id: number; op: "parseFfprobeLite"; raw: string }
  | { id: number; op: "highlightJsonTokens"; raw: string | null | undefined };

type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

type PendingEntry = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
};

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

let sharedWorker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingEntry>();

const canUseWorker = (): boolean => {
  if (isTestEnv) return false;
  return typeof window !== "undefined" && typeof Worker !== "undefined";
};

const getWorker = (): Worker | null => {
  if (!canUseWorker()) return null;
  if (sharedWorker) return sharedWorker;

  try {
    sharedWorker = new Worker(new URL("./workers/jsonHeavy.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    console.warn("asyncJson: failed to start worker, falling back to main thread", error);
    sharedWorker = null;
    return null;
  }

  sharedWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(msg.error));
    }
  };

  sharedWorker.onerror = (event) => {
    console.error("asyncJson: worker error", event);
  };

  return sharedWorker;
};

const callWorker = <T>(op: WorkerOp, payload: Omit<WorkerRequest, "id" | "op">): Promise<T> => {
  const worker = getWorker();
  if (!worker) {
    return Promise.reject(new Error("worker unavailable"));
  }
  const id = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg: WorkerRequest = { id, op, ...(payload as any) } as WorkerRequest;
    worker.postMessage(msg);
  });
};

export const parseJsonAsync = async <T = unknown>(raw: string): Promise<T> => {
  try {
    return await callWorker<T>("parseJson", { raw });
  } catch {
    return JSON.parse(raw) as T;
  }
};

export const stringifyJsonAsync = async (value: unknown, space?: number): Promise<string> => {
  try {
    return await callWorker<string>("stringifyJson", { value, space });
  } catch {
    return JSON.stringify(value, null, space);
  }
};

export const parseFfprobeJsonAsyncLite = async (raw: string): Promise<ParsedMediaAnalysis> => {
  try {
    return (await callWorker<ParsedMediaAnalysis>("parseFfprobeLite", { raw })) as ParsedMediaAnalysis;
  } catch {
    const parsed = parseFfprobeJson(raw);
    return { ...parsed, raw: null };
  }
};

export const highlightJsonTokensAsync = async (raw: string | null | undefined): Promise<HighlightToken[]> => {
  try {
    return (await callWorker<HighlightToken[]>("highlightJsonTokens", { raw })) as HighlightToken[];
  } catch {
    return highlightJsonTokens(raw);
  }
};
