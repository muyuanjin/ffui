import { computed, nextTick, onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, ensureJobPreview, hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import {
  invalidateJobPreviewAutoEnsure,
  jobPreviewSourceKey,
  requestJobPreviewAutoEnsure,
} from "@/components/queue-item/previewAutoEnsure";
import { useQueuePerfHints } from "@/components/panels/queue/queuePerfHints";
import { schedulePreviewLoad } from "@/components/queue-item/previewLoadScheduler";
import { getDecodedPreviewUrl, markPreviewDecoded } from "@/components/queue-item/previewWarmCache";
import { appendQueryParam } from "@/lib/url";
import { imagePreviewSource } from "./imagePreviewSource";

type DesiredHeightInput = number | null | undefined | { value: number | null | undefined };

export function useQueueItemPreview(options: {
  job: ComputedRef<TranscodeJob>;
  isTestEnv: boolean;
  desiredHeightPx?: DesiredHeightInput;
}): {
  previewUrl: Ref<string | null>;
  handlePreviewError: () => Promise<void>;
} {
  const previewUrl = ref<string | null>(null);
  const previewFallbackLoaded = ref(false);
  const previewRescreenshotAttempted = ref(false);
  const previewErrorHandlingInFlight = ref(false);
  const lastPreviewPath = ref<string | null>(null);
  const ensuredPreviewPath = ref<string | null>(null);
  const lastJobId = ref<string | null>(null);
  let lastSourceKey: string | null = null;
  const lastDesiredHeightPx = ref<number>(180);
  const previewVariantRetryAttempted = ref(false);
  let autoEnsureHandle: { promise: Promise<string | null>; cancel: () => void } | null = null;
  let pendingPreviewLoadCancel: (() => void) | null = null;
  let pendingPreviewLoadAbort: AbortController | null = null;
  let desiredPreviewUrl: string | null = null;
  let desiredPreviewToken = 0;

  const job = computed(() => options.job.value);
  const desiredHeightPx = computed(() => {
    const raw = options.desiredHeightPx;
    const value = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
    const parsed = Math.floor(Number(value ?? 180));
    if (!Number.isFinite(parsed) || parsed <= 0) return 180;
    return parsed;
  });
  const perfHints = useQueuePerfHints();
  const allowAutoEnsure = computed(() => perfHints?.allowPreviewAutoEnsure.value ?? true);
  const allowPreviewLoads = computed(() => perfHints?.allowPreviewLoads.value ?? true);

  watch(
    () => ({
      id: job.value.id,
      previewPath: job.value.previewPath,
      previewRevision: job.value.previewRevision,
      type: job.value.type,
      status: job.value.status,
      inputPath: job.value.inputPath,
      outputPath: job.value.outputPath,
      ensuredPreviewPath: ensuredPreviewPath.value,
      desiredHeightPx: desiredHeightPx.value,
      previewCacheKey: jobPreviewSourceKey(job.value),
      allowAutoEnsure: allowAutoEnsure.value,
      allowPreviewLoads: allowPreviewLoads.value,
    }),
    ({
      id,
      previewPath,
      previewRevision,
      type,
      ensuredPreviewPath: ensured,
      desiredHeightPx: desiredHeightPxSnapshot,
      previewCacheKey,
      allowAutoEnsure: allowAutoEnsureSnapshot,
      allowPreviewLoads: allowPreviewLoadsSnapshot,
    }) => {
      let currentEnsured = ensured;
      if (previewCacheKey !== lastSourceKey) {
        lastSourceKey = previewCacheKey;
        currentEnsured = null;
        ensuredPreviewPath.value = null;
        previewVariantRetryAttempted.value = false;
        previewRescreenshotAttempted.value = false;
        autoEnsureHandle?.cancel();
        autoEnsureHandle = null;
      }
      if (id !== lastJobId.value) {
        lastJobId.value = id;
        ensuredPreviewPath.value = null;
        lastDesiredHeightPx.value = desiredHeightPxSnapshot;
        previewVariantRetryAttempted.value = false;
        if (autoEnsureHandle) {
          autoEnsureHandle.cancel();
          autoEnsureHandle = null;
        }
        if (pendingPreviewLoadCancel) {
          pendingPreviewLoadCancel();
          pendingPreviewLoadCancel = null;
        }
        if (pendingPreviewLoadAbort) {
          pendingPreviewLoadAbort.abort();
          pendingPreviewLoadAbort = null;
        }
        desiredPreviewUrl = null;
        desiredPreviewToken += 1;
        previewUrl.value = null;
      }

      if (desiredHeightPxSnapshot !== lastDesiredHeightPx.value) {
        lastDesiredHeightPx.value = desiredHeightPxSnapshot;
        ensuredPreviewPath.value = null;
        previewVariantRetryAttempted.value = false;
        if (autoEnsureHandle) {
          autoEnsureHandle.cancel();
          autoEnsureHandle = null;
        }
      }

      previewFallbackLoaded.value = false;
      if ((previewPath ?? null) !== lastPreviewPath.value) {
        previewRescreenshotAttempted.value = false;
        lastPreviewPath.value = previewPath ?? null;
        previewVariantRetryAttempted.value = false;
        if (type === "video" && desiredHeightPxSnapshot !== 180) {
          ensuredPreviewPath.value = null;
          if (autoEnsureHandle) {
            autoEnsureHandle.cancel();
            autoEnsureHandle = null;
          }
        }
      }

      if (type === "video" || type === "audio") {
        const needsImmediateVisiblePreview = previewUrl.value == null;
        const shouldEnsure =
          !ensuredPreviewPath.value &&
          (allowAutoEnsureSnapshot || needsImmediateVisiblePreview) &&
          hasTauri() &&
          ((type === "video" && desiredHeightPxSnapshot !== 180) || !previewPath);
        if (!shouldEnsure && autoEnsureHandle) {
          autoEnsureHandle.cancel();
          autoEnsureHandle = null;
        } else if (shouldEnsure && !autoEnsureHandle) {
          const handle = requestJobPreviewAutoEnsure(id, {
            heightPx: type === "audio" ? 180 : desiredHeightPxSnapshot,
            cacheKey: previewCacheKey,
            priority: "high",
          });
          autoEnsureHandle = handle;
          void handle.promise.then((resolved) => {
            if (!resolved) return;
            if (autoEnsureHandle !== handle || jobPreviewSourceKey(job.value) !== previewCacheKey) return;
            ensuredPreviewPath.value = resolved;
          });
        }
      }

      let path: string | null = null;

      if (previewPath) {
        if (type === "video" && desiredHeightPxSnapshot !== 180) {
          path = currentEnsured || previewPath;
        } else {
          path = previewPath;
          ensuredPreviewPath.value = null;
        }
      } else if (type === "image") {
        path = imagePreviewSource(job.value);
      } else if (type === "video" || type === "audio") {
        path = currentEnsured || null;
      }

      if (!path) {
        desiredPreviewUrl = null;
        desiredPreviewToken += 1;
        if (pendingPreviewLoadCancel) {
          pendingPreviewLoadCancel();
          pendingPreviewLoadCancel = null;
        }
        if (pendingPreviewLoadAbort) {
          pendingPreviewLoadAbort.abort();
          pendingPreviewLoadAbort = null;
        }
        previewUrl.value = null;
        return;
      }

      const nextDesired = buildJobPreviewUrl(path, previewRevision);
      desiredPreviewUrl = nextDesired;
      desiredPreviewToken += 1;
      const token = desiredPreviewToken;

      if (pendingPreviewLoadCancel) {
        pendingPreviewLoadCancel();
        pendingPreviewLoadCancel = null;
      }
      if (pendingPreviewLoadAbort) {
        pendingPreviewLoadAbort.abort();
        pendingPreviewLoadAbort = null;
      }

      if (!nextDesired) {
        previewUrl.value = null;
        return;
      }

      if (previewUrl.value === nextDesired) return;
      const needsImmediateVisiblePreview = previewUrl.value == null;
      if (!allowPreviewLoadsSnapshot) {
        const scrolling = perfHints?.isScrolling.value ?? false;
        if (scrolling) {
          const warmed = getDecodedPreviewUrl(id, nextDesired);
          if (warmed) {
            previewUrl.value = warmed;
            return;
          }
        }
        if (!needsImmediateVisiblePreview) return;
      }

      const abortController = new AbortController();
      pendingPreviewLoadAbort = abortController;

      const shouldHighPriority = needsImmediateVisiblePreview;
      const cancelScheduled = schedulePreviewLoad(
        `queue-preview:${id}|h=${desiredHeightPxSnapshot}`,
        async () => {
          if (token !== desiredPreviewToken) return;
          if (abortController.signal.aborted) return;
          if (!allowPreviewLoads.value && !needsImmediateVisiblePreview) return;
          if (desiredPreviewUrl !== nextDesired) return;
          if (options.isTestEnv) {
            previewUrl.value = nextDesired;
            return;
          }

          // Show immediately; keep the scheduler occupied until decode completes
          // to cap concurrent IO/decodes without delaying visible thumbnails.
          previewUrl.value = nextDesired;

          const canPredecode = typeof Image === "function";
          if (!canPredecode) {
            markPreviewDecoded(id, nextDesired);
            return;
          }

          try {
            if (abortController.signal.aborted) return;
            if (!allowPreviewLoads.value && !needsImmediateVisiblePreview) return;
            const img = new Image();
            (img as any).decoding = "async";
            img.src = nextDesired;
            const raceAbort = async <T>(promise: Promise<T>) => {
              if (abortController.signal.aborted) throw new Error("aborted");
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
                abortController.signal.addEventListener("abort", onAbort);
              });
              try {
                return await Promise.race([promise, abortPromise]);
              } finally {
                if (onAbort) abortController.signal.removeEventListener("abort", onAbort);
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
            markPreviewDecoded(id, nextDesired);
          } catch {
            // best-effort
          }
        },
        { priority: shouldHighPriority ? "high" : "normal" },
      );

      pendingPreviewLoadCancel = () => {
        abortController.abort();
        cancelScheduled();
      };
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    if (autoEnsureHandle) {
      autoEnsureHandle.cancel();
      autoEnsureHandle = null;
    }
    if (pendingPreviewLoadCancel) {
      pendingPreviewLoadCancel();
      pendingPreviewLoadCancel = null;
    }
    if (pendingPreviewLoadAbort) {
      pendingPreviewLoadAbort.abort();
      pendingPreviewLoadAbort = null;
    }
  });

  const handlePreviewError = async () => {
    const path = ensuredPreviewPath.value || job.value.previewPath;
    if (!path) return;
    if (!hasTauri()) return;
    if (previewFallbackLoaded.value) return;
    if (previewErrorHandlingInFlight.value) return;

    previewErrorHandlingInFlight.value = true;
    const sourceKey = jobPreviewSourceKey(job.value);

    try {
      const heightPx = job.value.type === "audio" ? 180 : lastDesiredHeightPx.value;
      const cacheKey = sourceKey;

      if (!previewVariantRetryAttempted.value) {
        previewVariantRetryAttempted.value = true;
        invalidateJobPreviewAutoEnsure(job.value.id, { heightPx, cacheKey });
        try {
          previewUrl.value = null;
          await nextTick();
          const handle = requestJobPreviewAutoEnsure(job.value.id, { heightPx, cacheKey });
          const regenerated = await handle.promise;
          if (jobPreviewSourceKey(job.value) !== sourceKey) return;
          if (regenerated) {
            ensuredPreviewPath.value = heightPx === 180 ? null : regenerated;
            const url = buildJobPreviewUrl(regenerated, job.value.previewRevision);
            previewUrl.value = url ? appendQueryParam(url, "ffuiPreviewRetry", String(Date.now())) : null;
            previewFallbackLoaded.value = false;
            await nextTick();
            return;
          }
        } catch {
          // fall back to data URL / base preview regeneration below
        }
      }

      try {
        const url = await loadPreviewDataUrl(path);
        if (jobPreviewSourceKey(job.value) !== sourceKey) return;
        previewUrl.value = url;
        previewFallbackLoaded.value = true;
        await nextTick();
        return;
      } catch (error) {
        if (previewRescreenshotAttempted.value) {
          console.error("QueueItem: failed to load preview via data URL fallback", error);
          return;
        }

        previewRescreenshotAttempted.value = true;
        if (!options.isTestEnv) {
          console.warn("QueueItem: preview missing or unreadable, attempting regeneration", error);
        }

        try {
          const regenerated = await ensureJobPreview(job.value.id);
          if (jobPreviewSourceKey(job.value) !== sourceKey) return;
          if (regenerated) {
            previewUrl.value = buildJobPreviewUrl(regenerated, job.value.previewRevision);
            previewFallbackLoaded.value = false;
            await nextTick();
          }
        } catch (regenError) {
          console.error("QueueItem: failed to regenerate preview", regenError);
        }
      }
    } finally {
      previewErrorHandlingInFlight.value = false;
    }
  };

  return { previewUrl, handlePreviewError };
}
