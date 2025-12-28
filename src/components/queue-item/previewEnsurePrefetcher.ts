import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, hasTauri } from "@/lib/backend";
import { requestJobPreviewAutoEnsure } from "@/components/queue-item/previewAutoEnsure";
import { decodeUrl } from "@/components/queue-item/previewDecodeUrl";
import { schedulePreviewLoad } from "@/components/queue-item/previewLoadScheduler";
import { getDecodedPreviewUrl } from "@/components/queue-item/previewWarmCache";

type Cancel = () => void;

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
