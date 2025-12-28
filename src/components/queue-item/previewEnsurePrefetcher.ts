import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, hasTauri } from "@/lib/backend";
import { requestJobPreviewAutoEnsure } from "@/components/queue-item/previewAutoEnsure";
import { schedulePreviewLoad } from "@/components/queue-item/previewLoadScheduler";
import { getDecodedPreviewUrl, markPreviewDecoded } from "@/components/queue-item/previewWarmCache";

type Cancel = () => void;

const decodeUrl = async (jobId: string, url: string, signal: AbortSignal) => {
  if (signal.aborted) return;
  if (typeof Image !== "function") {
    markPreviewDecoded(jobId, url);
    return;
  }

  const img = new Image();
  (img as any).decoding = "async";
  img.src = url;

  const raceAbort = async <T>(promise: Promise<T>) => {
    if (signal.aborted) throw new Error("aborted");
    let onAbort: (() => void) | null = null;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => {
        try {
          img.onload = null;
          img.onerror = null;
          img.src = "";
        } catch {
          // ignore
        }
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort);
    });
    try {
      return await Promise.race([promise, abortPromise]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  };

  const decode = (img as any).decode;
  if (typeof decode === "function") {
    await raceAbort(decode.call(img));
  } else {
    await raceAbort(
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
      }),
    );
  }

  if (signal.aborted) return;
  markPreviewDecoded(jobId, url);
};

type Op = {
  token: number;
  cancelEnsure: Cancel;
  cancelDecode: Cancel;
};

export function createQueuePreviewEnsurePrefetcher(): {
  setTargetJobs: (jobs: readonly TranscodeJob[]) => void;
  clear: () => void;
} {
  const opByJobId = new Map<string, Op>();
  let tokenSeq = 0;

  const clear = () => {
    for (const op of opByJobId.values()) {
      op.cancelDecode();
      op.cancelEnsure();
    }
    opByJobId.clear();
  };

  const setTargetJobs = (jobs: readonly TranscodeJob[]) => {
    const nextJobIds = new Set<string>();

    for (const job of jobs) {
      const jobId = job?.id;
      if (!jobId) continue;
      if (job.type !== "video") continue;
      if (job.previewPath) continue;
      if (!hasTauri()) continue;

      nextJobIds.add(jobId);

      const existing = opByJobId.get(jobId);
      if (existing) continue;

      const revision = job.previewRevision ?? null;
      const token = (tokenSeq = (tokenSeq + 1) >>> 0);

      const ensureHandle = requestJobPreviewAutoEnsure(jobId);
      const abortController = new AbortController();

      const op: Op = {
        token,
        cancelEnsure: () => ensureHandle.cancel(),
        cancelDecode: () => abortController.abort(),
      };
      opByJobId.set(jobId, op);

      void ensureHandle.promise
        .then((ensuredPath) => {
          const current = opByJobId.get(jobId);
          if (!current || current.token !== token) return;

          const safePath = (ensuredPath ?? "").trim();
          if (!safePath) return;

          const url = buildJobPreviewUrl(safePath, revision);
          if (!url) return;
          if (getDecodedPreviewUrl(jobId, url)) return;

          const cancelScheduled = schedulePreviewLoad(
            `queue-ensure-prefetch:${jobId}`,
            async () => {
              try {
                await decodeUrl(jobId, url, abortController.signal);
              } catch {
                // ignore
              }
            },
            { priority: "normal" },
          );

          current.cancelDecode = () => {
            abortController.abort();
            cancelScheduled();
          };
        })
        .catch(() => {});
    }

    for (const [jobId, op] of opByJobId) {
      if (nextJobIds.has(jobId)) continue;
      op.cancelDecode();
      op.cancelEnsure();
      opByJobId.delete(jobId);
    }
  };

  return { setTargetJobs, clear };
}
