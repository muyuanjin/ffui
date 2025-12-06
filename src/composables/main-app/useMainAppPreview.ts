import { computed, ref, type Ref } from "vue";
import type { CompositeSmartScanTask, FFmpegPreset, TranscodeJob } from "@/types";
import { buildPreviewUrl, hasTauri, selectPlayableMediaPath } from "@/lib/backend";
import { openPath as openPathWithSystem } from "@tauri-apps/plugin-opener";

export interface UseMainAppPreviewOptions {
  presets: Ref<FFmpegPreset[]>;
  dialogManager: {
    selectedJob: Ref<TranscodeJob | null>;
    openPreview: (job: TranscodeJob) => void;
    closePreview: () => void;
    openBatchDetail: (batch: CompositeSmartScanTask) => void;
  };
  /** Optional i18n translation function for preview error messages. */
  t?: (key: string) => string;
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
  const { presets, dialogManager, t } = options;

  const previewUrl = ref<string | null>(null);
  const previewIsImage = ref(false);
  const previewError = ref<string | null>(null);
  // Keep an ordered list of candidate paths for the current preview so we can
  // fall back when one of them fails to load or becomes unavailable.
  const previewCandidatePaths = ref<string[]>([]);
  const previewCandidateIndex = ref<number>(-1);
  const currentPreviewPath = ref<string | null>(null);

  const buildPreviewCandidates = (job: TranscodeJob | null): string[] => {
    if (!job) return [];

    const tmpOutput = job.waitMetadata?.tmpOutputPath ?? undefined;
    const input = job.inputPath ?? undefined;
    const output = job.outputPath ?? undefined;
    const candidates: (string | undefined)[] = [];

    if (job.type === "image") {
      // 图片任务：只需要输入路径即可；预览图本身由 previewPath/inline 负责。
      if (input) candidates.push(input);
    } else {
      const isCompletedStatus = job.status === "completed";

      // 对于未完成/失败/跳过/取消的任务，更可靠的是原始输入或临时输出文件：
      // - 等待/处理中：可能只有 inputPath 或 tmpOutputPath 存在，outputPath 只是计划路径。
      // - 失败/跳过/取消：输出文件可能不存在或不完整，直接用 outputPath 容易导致“无可播放视频”。
      // 只有在真正 completed 时才优先使用最终输出路径。
      if (!isCompletedStatus) {
        if (tmpOutput) candidates.push(tmpOutput);
        if (input) candidates.push(input);
        if (output) candidates.push(output);
      } else {
        // 已完成任务：优先使用最终输出；如果用户把转码结果“替换原文件”，那么 output
        // 可能被删掉，但 input 仍然存在，后端会自动回退到 input。
        if (output) candidates.push(output);
        if (input) candidates.push(input);
        if (tmpOutput) candidates.push(tmpOutput);
      }
    }

    // 去重但保持顺序，防止 input/output 指向同一路径时产生重复尝试。
    return Array.from(new Set(candidates.filter((p): p is string => !!p)));
  };

  const openJobPreviewFromQueue = async (job: TranscodeJob) => {
    previewUrl.value = null;
    previewIsImage.value = job.type === "image";
    previewError.value = null;
    dialogManager.openPreview(job);
    previewCandidatePaths.value = buildPreviewCandidates(job);
    previewCandidateIndex.value = -1;
    currentPreviewPath.value = null;

    const candidates = previewCandidatePaths.value;
    if (!candidates.length) {
      // 没有任何可用路径时直接展示“无预览”占位文案。
      return;
    }

    try {
      let selectedPath: string | null = null;

      if (hasTauri()) {
        // 让后端根据真实文件存在情况挑选首选路径，避免指向已删除/不存在的输出文件。
        selectedPath = await selectPlayableMediaPath(candidates);
      }

      if (!selectedPath) {
        selectedPath = candidates[0] ?? null;
      }

      if (!selectedPath) {
        return;
      }

      const idx = candidates.indexOf(selectedPath);
      previewCandidateIndex.value = idx >= 0 ? idx : 0;
      currentPreviewPath.value = selectedPath;

      const url = buildPreviewUrl(selectedPath);
      previewUrl.value = url;
    } catch (e) {
      console.error("Failed to build preview URL for job:", e);
      const key =
        job.type === "image"
          ? "jobDetail.previewImageError"
          : "jobDetail.previewVideoError";
      previewError.value = (t?.(key) as string) ?? "";
    }
  };

  const closeExpandedPreview = () => {
    dialogManager.closePreview();
    previewUrl.value = null;
    previewError.value = null;
    previewCandidatePaths.value = [];
    previewCandidateIndex.value = -1;
    currentPreviewPath.value = null;
  };

  const handleExpandedPreviewError = () => {
    const candidates = previewCandidatePaths.value;

    // 没有候选路径或者已经尝试完所有路径时，直接给出错误提示。
    if (!candidates.length || previewCandidateIndex.value >= candidates.length - 1) {
      const key = "jobDetail.previewVideoError";
      previewError.value = (t?.(key) as string) ?? "";
      return;
    }

    // 尝试下一个候选路径，避免因为某个输出文件损坏/不可解码而完全失效。
    const nextIndex = previewCandidateIndex.value + 1;
    const nextPath = candidates[nextIndex];
    if (!nextPath) {
      const key = "jobDetail.previewVideoError";
      previewError.value = (t?.(key) as string) ?? "";
      return;
    }

    previewCandidateIndex.value = nextIndex;
    currentPreviewPath.value = nextPath;
    previewError.value = null;
    previewUrl.value = buildPreviewUrl(nextPath);
  };

  const handleExpandedImagePreviewError = () => {
    const key = "jobDetail.previewImageError";
    previewError.value = (t?.(key) as string) ?? "";
  };

  const openPreviewInSystemPlayer = async () => {
    const job = dialogManager.selectedJob.value;
    if (!job) return;
    if (!hasTauri()) return;

    const candidates = buildPreviewCandidates(job);
    if (!candidates.length) return;

    // 当前预览路径（如果有）应当优先使用，其次再让后端根据存在性做一次筛选。
    const mergedCandidates = currentPreviewPath.value
      ? [currentPreviewPath.value, ...candidates]
      : candidates.slice();
    const uniqueCandidates = Array.from(new Set(mergedCandidates));

    let path: string | null = null;
    try {
      path = await selectPlayableMediaPath(uniqueCandidates);
    } catch (e) {
      console.error("Failed to select playable path for system player, falling back", e);
    }

    if (!path) {
      path = uniqueCandidates[0] ?? null;
    }

    if (!path) return;

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
