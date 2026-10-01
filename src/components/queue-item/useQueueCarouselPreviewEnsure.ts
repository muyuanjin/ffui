import { reactive, type ComputedRef } from "vue";
import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, buildPreviewUrl, hasTauri } from "@/lib/backend";
import {
  invalidateJobPreviewAutoEnsure,
  jobPreviewSourceKey,
  requestJobPreviewAutoEnsure,
} from "@/components/queue-item/previewAutoEnsure";

type EnsureHandle = { promise: Promise<string | null>; cancel: () => void; sourceKey: string };

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
  const previewCacheSources = reactive<Record<string, string>>({});
  const failedPreviewSources = reactive<Record<string, string>>({});
  const pendingPreviewEnsures = new Map<string, EnsureHandle>();
  const previewSourceKey = jobPreviewSourceKey;

  const getPreviewUrl = (item: QueueListItem): string | null => {
    const job = opts.getItemJob(item);
    if (!job) return null;

    if (previewCache[job.id] && previewCacheSources[job.id] === previewSourceKey(job)) {
      return buildJobPreviewUrl(previewCache[job.id], job.previewRevision);
    }

    if (failedPreviewSources[job.id] === previewSourceKey(job)) return null;

    if (job.previewPath) {
      return buildJobPreviewUrl(job.previewPath, job.previewRevision);
    }

    if (job.type === "image") {
      return buildPreviewUrl(job.outputPath || job.inputPath || null);
    }

    return null;
  };

  const requestPreview = async (job: TranscodeJob) => {
    const sourceKey = previewSourceKey(job);
    const pending = pendingPreviewEnsures.get(job.id);
    if (pending?.sourceKey === sourceKey) return;
    pending?.cancel();
    const cacheKey = sourceKey;
    const handle = {
      ...requestJobPreviewAutoEnsure(job.id, { heightPx: job.type === "audio" ? 180 : heightPx, cacheKey }),
      sourceKey,
    };
    pendingPreviewEnsures.set(job.id, handle);
    try {
      const path = await handle.promise.catch(() => null);
      const currentItem = opts.displayedItems.value.find((candidate) => opts.getItemJob(candidate)?.id === job.id);
      const currentJob = currentItem ? opts.getItemJob(currentItem) : null;
      if (pendingPreviewEnsures.get(job.id) === handle && currentJob && previewSourceKey(currentJob) === sourceKey) {
        previewCacheSources[job.id] = sourceKey;
        previewCache[job.id] = path;
      }
    } finally {
      if (pendingPreviewEnsures.get(job.id) === handle) pendingPreviewEnsures.delete(job.id);
    }
  };

  const ensurePreviewForItem = async (item: QueueListItem) => {
    const job = opts.getItemJob(item);
    if (!job || (job.type !== "video" && job.type !== "audio")) return;
    if (previewCacheSources[job.id] === previewSourceKey(job)) return;
    if (job.type === "audio" && job.previewPath && failedPreviewSources[job.id] !== previewSourceKey(job)) return;
    if (!hasTauri() || !opts.allowAutoEnsure.value) return;
    await requestPreview(job);
  };

  const handlePreviewError = async (jobId: string) => {
    const safeJobId = String(jobId ?? "").trim();
    if (!safeJobId) return;

    previewCache[safeJobId] = null;

    const item = opts.displayedItems.value.find((candidate) => opts.getItemJob(candidate)?.id === safeJobId);
    const job = item ? opts.getItemJob(item) : null;
    if (job) failedPreviewSources[safeJobId] = previewSourceKey(job);

    const pending = pendingPreviewEnsures.get(safeJobId);
    if (pending) {
      pending.cancel();
      pendingPreviewEnsures.delete(safeJobId);
    }

    if (!hasTauri()) return;
    if (!opts.allowAutoEnsure.value) return;

    if (!job || (job.type !== "video" && job.type !== "audio")) return;

    const cacheKey = previewSourceKey(job);
    const previewHeight = job.type === "audio" ? 180 : heightPx;
    invalidateJobPreviewAutoEnsure(safeJobId, { heightPx: previewHeight, cacheKey });

    await requestPreview(job);
  };

  return {
    previewCache,
    pendingPreviewEnsures,
    getPreviewUrl,
    ensurePreviewForItem,
    handlePreviewError,
  };
}
