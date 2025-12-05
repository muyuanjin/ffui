import { computed, ref, type Ref } from "vue";
import type { CompositeSmartScanTask, FFmpegPreset, TranscodeJob } from "@/types";
import { buildPreviewUrl, hasTauri } from "@/lib/backend";
import { openPath as openPathWithSystem } from "@tauri-apps/plugin-opener";

export interface UseMainAppPreviewOptions {
  presets: Ref<FFmpegPreset[]>;
  dialogManager: {
    selectedJob: Ref<TranscodeJob | null>;
    openPreview: (job: TranscodeJob) => void;
    closePreview: () => void;
    openBatchDetail: (batch: CompositeSmartScanTask) => void;
  };
}

export interface UseMainAppPreviewReturn {
  previewUrl: Ref<string | null>;
  previewIsImage: Ref<boolean>;
  previewError: Ref<string | null>;
  openJobPreviewFromQueue: (job: TranscodeJob) => Promise<void>;
  closeExpandedPreview: () => void;
  handleExpandedPreviewError: () => void;
  handleExpandedImagePreviewError: () => void;
  openPreviewInSystemPlayer: () => Promise<void>;
  openBatchDetail: (batch: CompositeSmartScanTask) => void;
  handleJobDetailExpandPreview: () => void;
  selectedJobPreset: Ref<FFmpegPreset | null>;
}

/**
 * Preview dialog state and helpers for queue/jobs.
 */
export function useMainAppPreview(
  options: UseMainAppPreviewOptions,
): UseMainAppPreviewReturn {
  const { presets, dialogManager } = options;

  const previewUrl = ref<string | null>(null);
  const previewIsImage = ref(false);
  const previewError = ref<string | null>(null);

  const selectPlayablePath = (job: TranscodeJob | null): string | null => {
    if (!job) return null;

    const tmpOutput = job.waitMetadata?.tmpOutputPath ?? null;
    const isCompletedStatus = job.status === "completed";

    // 对于未完成/失败/跳过/取消的任务，更可靠的是原始输入或临时输出文件：
    // - 等待/处理中：可能只有 inputPath 或 tmpOutputPath 存在，outputPath 只是计划路径。
    // - 失败/跳过/取消：输出文件可能不存在或不完整，直接用 outputPath 容易导致“无可播放视频”。
    // 只有在真正 completed 时才优先使用最终输出路径。
    if (!isCompletedStatus) {
      return tmpOutput ?? job.inputPath ?? job.outputPath ?? null;
    }

    return job.outputPath ?? job.inputPath ?? tmpOutput ?? null;
  };

  const openJobPreviewFromQueue = async (job: TranscodeJob) => {
    previewUrl.value = null;
    previewIsImage.value = job.type === "image";
    previewError.value = null;
    dialogManager.openPreview(job);

    if (hasTauri()) {
      try {
        const path = selectPlayablePath(job);
        if (path) {
          const url = await buildPreviewUrl(path);
          previewUrl.value = url;
        }
      } catch (e) {
        previewError.value = String(e);
      }
    }
  };

  const closeExpandedPreview = () => {
    dialogManager.closePreview();
    previewUrl.value = null;
    previewError.value = null;
  };

  const handleExpandedPreviewError = () => {
    previewError.value =
      "无法加载预览，视频文件可能正在被占用或已损坏。";
  };

  const handleExpandedImagePreviewError = () => {
    previewError.value =
      "无法加载图片预览，文件可能正在被占用或已损坏。";
  };

  const openPreviewInSystemPlayer = async () => {
    const job = dialogManager.selectedJob.value;
    if (!job) return;
    const path = selectPlayablePath(job);
    if (!path || !hasTauri()) return;
    try {
      await openPathWithSystem(path);
    } catch (e) {
      console.error("Failed to open in system player:", e);
    }
  };

  const openBatchDetail = (batch: CompositeSmartScanTask) => {
    dialogManager.openBatchDetail(batch);
  };

  const handleJobDetailExpandPreview = () => {
    const job = dialogManager.selectedJob.value;
    if (job) {
      void openJobPreviewFromQueue(job);
    }
  };

  const selectedJobPreset = computed<FFmpegPreset | null>(() => {
    const job = dialogManager.selectedJob.value;
    if (!job) return null;
    return presets.value.find((p) => p.id === job.presetId) ?? null;
  });

  return {
    previewUrl,
    previewIsImage,
    previewError,
    openJobPreviewFromQueue,
    closeExpandedPreview,
    handleExpandedPreviewError,
    handleExpandedImagePreviewError,
    openPreviewInSystemPlayer,
    openBatchDetail,
    handleJobDetailExpandPreview,
    selectedJobPreset,
  };
}

export default useMainAppPreview;
