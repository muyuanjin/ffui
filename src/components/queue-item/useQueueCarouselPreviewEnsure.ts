import { reactive, type ComputedRef } from "vue";
import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, buildPreviewUrl, hasTauri } from "@/lib/backend";
import { invalidateJobPreviewAutoEnsure, requestJobPreviewAutoEnsure } from "@/components/queue-item/previewAutoEnsure";

type EnsureHandle = { promise: Promise<string | null>; cancel: () => void };

export function useQueueCarouselPreviewEnsure(opts: {
  displayedItems: ComputedRef<QueueListItem[]>;
  allowAutoEnsure: ComputedRef<boolean>;
  getItemJob: (item: QueueListItem) => TranscodeJob | null;
  heightPx: number;
}): {
  previewCache: Record<string, string | null>;
  pendingPreviewEnsures: Map<string, EnsureHandle>;
  getPreviewUrl: (item: QueueListItem) => string | null;
  ensurePreviewForItem: (item: QueueListItem) => Promise<void>;
  handlePreviewError: (jobId: string) => Promise<void>;
} {
  const heightPx = Math.max(1, Math.floor(Number(opts.heightPx ?? 1080)));
  const previewCache = reactive<Record<string, string | null>>({});
  const pendingPreviewEnsures = new Map<string, EnsureHandle>();

  const getPreviewUrl = (item: QueueListItem): string | null => {
    const job = opts.getItemJob(item);
    if (!job) return null;

    if (previewCache[job.id]) {
      return buildJobPreviewUrl(previewCache[job.id], job.previewRevision);
    }

    if (job.previewPath) {
      return buildJobPreviewUrl(job.previewPath, job.previewRevision);
    }

    if (job.type === "image") {
      return buildPreviewUrl(job.outputPath || job.inputPath || null);
    }

    return null;
  };

  const ensurePreviewForItem = async (item: QueueListItem) => {
    const job = opts.getItemJob(item);
    if (!job) return;
    if (previewCache[job.id] || job.type !== "video") return;
    if (!hasTauri()) return;
    if (!opts.allowAutoEnsure.value) return;
    if (pendingPreviewEnsures.has(job.id)) return;

    try {
      const cacheKey = job.previewPath ? `${job.previewPath}|rev=${Number(job.previewRevision ?? 0)}` : null;
      const handle = requestJobPreviewAutoEnsure(job.id, { heightPx, cacheKey });
      pendingPreviewEnsures.set(job.id, handle);
      const path = await handle.promise;
      if (path) previewCache[job.id] = path;
    } catch {
      // silent
    } finally {
      pendingPreviewEnsures.delete(job.id);
    }
  };

  const handlePreviewError = async (jobId: string) => {
    const safeJobId = String(jobId ?? "").trim();
    if (!safeJobId) return;

    previewCache[safeJobId] = null;

    const pending = pendingPreviewEnsures.get(safeJobId);
    if (pending) {
      pending.cancel();
      pendingPreviewEnsures.delete(safeJobId);
    }

    if (!hasTauri()) return;
    if (!opts.allowAutoEnsure.value) return;

    const item = opts.displayedItems.value.find((candidate) => opts.getItemJob(candidate)?.id === safeJobId);
    const job = item ? opts.getItemJob(item) : null;
    if (!job || job.type !== "video") return;

    const cacheKey = job.previewPath ? `${job.previewPath}|rev=${Number(job.previewRevision ?? 0)}` : null;
    invalidateJobPreviewAutoEnsure(safeJobId, { heightPx, cacheKey });

    try {
      const handle = requestJobPreviewAutoEnsure(safeJobId, { heightPx, cacheKey });
      pendingPreviewEnsures.set(safeJobId, handle);
      const path = await handle.promise;
      if (path) previewCache[safeJobId] = path;
    } catch {
      // silent
    } finally {
      pendingPreviewEnsures.delete(safeJobId);
    }
  };

  return {
    previewCache,
    pendingPreviewEnsures,
    getPreviewUrl,
    ensurePreviewForItem,
    handlePreviewError,
  };
}
