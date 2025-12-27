import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import type { TranscodeJob } from "@/types";
import { buildJobPreviewUrl, ensureJobPreview, hasTauri, loadPreviewDataUrl } from "@/lib/backend";

export function useQueueItemPreview(options: { job: ComputedRef<TranscodeJob>; isTestEnv: boolean }): {
  previewUrl: Ref<string | null>;
  handlePreviewError: () => Promise<void>;
} {
  const previewUrl = ref<string | null>(null);
  const previewFallbackLoaded = ref(false);
  const previewRescreenshotAttempted = ref(false);
  const previewErrorHandlingInFlight = ref(false);
  const lastPreviewPath = ref<string | null>(null);

  const job = computed(() => options.job.value);

  /**
   * 为队列项计算缩略图路径：
   * - 首选后端提供的 previewPath（通常是预生成的 jpg 预览图或 AVIF 输出）；
   * - 对于图片任务，当 previewPath 为空时，回退到 outputPath 或 inputPath，保证
   *   Batch Compress 图片子任务在“替换原文件”后仍然可以预览最终压缩结果；
   * - 视频任务仍然只依赖 previewPath，避免直接用视频文件作为 <img> 源。
   */
  watch(
    () => ({
      previewPath: job.value.previewPath,
      previewRevision: job.value.previewRevision,
      type: job.value.type,
      inputPath: job.value.inputPath,
      outputPath: job.value.outputPath,
    }),
    ({ previewPath, previewRevision, type, inputPath, outputPath }) => {
      previewFallbackLoaded.value = false;
      if ((previewPath ?? null) !== lastPreviewPath.value) {
        previewRescreenshotAttempted.value = false;
        lastPreviewPath.value = previewPath ?? null;
      }

      let path: string | null = null;

      if (previewPath) {
        path = previewPath;
      } else if (type === "image") {
        path = outputPath || inputPath || null;
      }

      if (!path) {
        previewUrl.value = null;
        return;
      }

      previewUrl.value = buildJobPreviewUrl(path, previewRevision);
    },
    { immediate: true },
  );

  const handlePreviewError = async () => {
    const path = job.value.previewPath;
    if (!path) return;
    if (!hasTauri()) return;
    if (previewFallbackLoaded.value) return;
    if (previewErrorHandlingInFlight.value) return;

    previewErrorHandlingInFlight.value = true;

    try {
      try {
        const url = await loadPreviewDataUrl(path);
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
