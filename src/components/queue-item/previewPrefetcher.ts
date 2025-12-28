import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl } from "@/lib/backend";
import { decodeUrl } from "@/components/queue-item/previewDecodeUrl";
import { schedulePreviewLoad } from "@/components/queue-item/previewLoadScheduler";
import { getDecodedPreviewUrl } from "@/components/queue-item/previewWarmCache";

type Cancel = () => void;

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
