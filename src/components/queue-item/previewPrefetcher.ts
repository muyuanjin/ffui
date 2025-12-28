import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl } from "@/lib/backend";
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

const computeJobPreviewUrl = (job: TranscodeJob): string | null => {
  const previewPath = job.previewPath;
  if (previewPath) return buildJobPreviewUrl(previewPath, job.previewRevision);

  if (job.type === "image") {
    const fallback = job.outputPath || job.inputPath || null;
    return buildJobPreviewUrl(fallback, job.previewRevision);
  }

  // Never try to use the input video itself as an <img> source.
  return null;
};

export function createQueuePreviewPrefetcher(): {
  setTargetJobs: (jobs: readonly TranscodeJob[]) => void;
  clear: () => void;
} {
  const cancelByJobId = new Map<string, { cancel: Cancel; url: string }>();

  const setTargetJobs = (jobs: readonly TranscodeJob[]) => {
    const nextJobIds = new Set<string>();

    for (const job of jobs) {
      const jobId = job?.id;
      if (!jobId) continue;
      const url = computeJobPreviewUrl(job);
      if (!url) continue;
      nextJobIds.add(jobId);

      const warmed = getDecodedPreviewUrl(jobId, url);
      if (warmed) continue;

      const existing = cancelByJobId.get(jobId);
      if (existing && existing.url === url) continue;
      if (existing) {
        existing.cancel();
        cancelByJobId.delete(jobId);
      }

      const abortController = new AbortController();
      const cancelScheduled = schedulePreviewLoad(
        `queue-prefetch:${jobId}`,
        async () => {
          try {
            await decodeUrl(jobId, url, abortController.signal);
          } catch {
            // ignore
          }
        },
        { priority: "normal" },
      );

      const cancel = () => {
        abortController.abort();
        cancelScheduled();
      };
      cancelByJobId.set(jobId, { cancel, url });
    }

    for (const [jobId, entry] of cancelByJobId) {
      if (nextJobIds.has(jobId)) continue;
      entry.cancel();
      cancelByJobId.delete(jobId);
    }
  };

  const clear = () => {
    for (const entry of cancelByJobId.values()) {
      entry.cancel();
    }
    cancelByJobId.clear();
  };

  return { setTargetJobs, clear };
}
