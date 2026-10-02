import { computed, onScopeDispose, ref, type Ref } from "vue";
import type { CompositeBatchCompressTask, FFmpegPreset, TranscodeJob, Translate } from "@/types";
import {
  buildPreviewUrl,
  hasTauri,
  probeMediaPreviewInfo,
  selectPlayableMediaPath,
  type PreviewMediaKind,
} from "@/lib/backend";
import { IMAGE_EXTENSIONS, AUDIO_EXTENSIONS } from "@/constants";

export type PreviewSourceMode = "output" | "input";

export interface UseMainAppPreviewOptions {
  presets: Ref<FFmpegPreset[]>;
  dialogManager: {
    selectedJob: Ref<TranscodeJob | null>;
    openPreview: (job: TranscodeJob) => void;
    closePreview: () => void;
    openBatchDetail: (batch: CompositeBatchCompressTask) => void;
  };
  /** Optional i18n translation function for preview error messages. */
  t?: Translate;
}

export interface UseMainAppPreviewReturn {
  previewUrl: Ref<string | null>;
  /** Raw filesystem path currently being previewed (best-effort). */
  previewPath: Ref<string | null>;
  previewIsImage: Ref<boolean>;
  previewMediaKind: Ref<PreviewMediaKind | null>;
  previewDurationSeconds: Ref<number | null>;
  previewLoading: Ref<boolean>;
  previewError: Ref<string | null>;
  previewSourceMode: Ref<PreviewSourceMode>;
  openJobPreviewFromQueue: (job: TranscodeJob) => Promise<void>;
  setPreviewSourceMode: (mode: PreviewSourceMode) => Promise<void>;
  closeExpandedPreview: () => void;
  handleExpandedPreviewError: () => Promise<void>;
  handleExpandedImagePreviewError: () => void;
  openPreviewInSystemPlayer: () => Promise<void>;
  openBatchDetail: (batch: CompositeBatchCompressTask) => void;
  handleJobDetailExpandPreview: () => void;
  selectedJobPreset: Ref<FFmpegPreset | null>;
}

/**
 * Preview dialog state and helpers for queue/jobs.
 */
export function useMainAppPreview(options: UseMainAppPreviewOptions): UseMainAppPreviewReturn {
  const { presets, dialogManager, t } = options;

  const previewUrl = ref<string | null>(null);
  const previewMediaKind = ref<PreviewMediaKind | null>(null);
  const previewIsImage = computed(() => previewMediaKind.value === "image");
  const previewDurationSeconds = ref<number | null>(null);
  const previewError = ref<string | null>(null);
  const previewSourceMode = ref<PreviewSourceMode>("output");
  const previewSourceSelection = ref<"auto" | "manual">("auto");
  const nativeErrorFailedPaths = ref<string[]>([]);
  const previewSelectionInFlight = ref(false);
  let previewSelectionToken = 0;
  let previewIntentToken = 0;
  onScopeDispose(() => {
    previewIntentToken += 1;
    previewSelectionToken += 1;
  });
  // Keep an ordered list of candidate paths for the current preview so we can
  // fall back when one of them fails to load or becomes unavailable.
  const previewCandidatePaths = ref<string[]>([]);
  const previewCandidateIndex = ref<number>(-1);
  const currentPreviewPath = ref<string | null>(null);

  const browserPreviewKind = (job: TranscodeJob, path: string): PreviewMediaKind => {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(extension)) return "image";
    if (AUDIO_EXTENSIONS.includes(extension)) return "audio";
    return path === job.inputPath && job.type !== "other" ? job.type : "video";
  };

  const inferSourceModeFromSelectedPath = (
    job: TranscodeJob,
    selectedPath: string | null | undefined,
    preferredMode: PreviewSourceMode,
  ): PreviewSourceMode | null => {
    const path = String(selectedPath ?? "").trim();
    if (!path) return null;

    const inputPath = String(job.inputPath ?? "").trim();
    const outputPath = String(job.outputPath ?? "").trim();
    const tmpOutputPath = String(job.waitMetadata?.tmpOutputPath ?? "").trim();

    // When input/output are the same (e.g. "replace original"), keep the caller's
    // preferred mode so the UI doesn't "fight" the user's selection.
    if (inputPath && outputPath && inputPath === outputPath && path === inputPath) {
      return preferredMode;
    }

    if (inputPath && path === inputPath) return "input";
    if ((outputPath && path === outputPath) || (tmpOutputPath && path === tmpOutputPath)) return "output";

    return null;
  };

  function buildPreviewCandidates(job: TranscodeJob | null, mode: PreviewSourceMode): string[] {
    if (!job) return [];

    const tmpOutput = job.waitMetadata?.tmpOutputPath ?? undefined;
    const input = job.inputPath ?? undefined;
    const output = job.outputPath ?? undefined;
    const candidates: (string | undefined)[] = [];

    const outputCandidates: (string | undefined)[] = [];
    if (job.status === "completed" || job.status === "failed") {
      if (output) outputCandidates.push(output);
      if (tmpOutput) outputCandidates.push(tmpOutput);
    } else {
      // In-flight: only allow tmp output (if any). Never try final output path.
      if (tmpOutput) outputCandidates.push(tmpOutput);
    }

    if (mode === "input") {
      if (input) candidates.push(input);
      candidates.push(...outputCandidates);
    } else {
      candidates.push(...outputCandidates);
      if (input) candidates.push(input);
    }

    // 去重但保持顺序，防止 input/output 指向同一路径时产生重复尝试。
    return Array.from(new Set(candidates.filter((p): p is string => !!p)));
  }

  const guessInitialPreviewSourceMode = (job: TranscodeJob): PreviewSourceMode => {
    // For in-flight jobs, default to input so users always see a stable and
    // complete source (tmp outputs may be incomplete or not playable yet).
    if (job.status !== "completed" && job.status !== "failed") {
      return "input";
    }

    const tmpOutput = (job.waitMetadata?.tmpOutputPath ?? "").trim();
    if (tmpOutput) return "output";

    const output = (job.outputPath ?? "").trim();
    if (job.status === "completed" && output) return "output";

    return "input";
  };

  const resolveInitialPreviewSelection = async (
    job: TranscodeJob,
  ): Promise<{ mode: PreviewSourceMode; selectedPath: string | null }> => {
    const tauriMode = hasTauri();

    // In-flight jobs should always start from input (even when tmp output exists).
    // Users can still switch to output mode manually if they want to inspect tmp output.
    if (job.status !== "completed" && job.status !== "failed") {
      const mode: PreviewSourceMode = "input";
      const candidates = buildPreviewCandidates(job, mode);
      if (tauriMode) return { mode, selectedPath: null };
      return { mode, selectedPath: candidates[0] ?? null };
    }

    if (!tauriMode) {
      const mode = guessInitialPreviewSourceMode(job);
      const candidates = buildPreviewCandidates(job, mode);
      return { mode, selectedPath: candidates[0] ?? null };
    }

    const candidates = buildPreviewCandidates(job, "output");
    if (!candidates.length) return { mode: "input", selectedPath: null };

    let selectedPath: string | null = null;
    try {
      selectedPath = await selectPlayableMediaPath(candidates);
    } catch (error) {
      console.error("Failed to select initial preview path", error);
    }

    const inputPath = (job.inputPath ?? "").trim();
    const mode: PreviewSourceMode = selectedPath && inputPath && selectedPath.trim() === inputPath ? "input" : "output";

    return { mode, selectedPath };
  };

  const applyPreviewSelection = async (
    job: TranscodeJob,
    mode: PreviewSourceMode,
    options?: {
      preserveMedia?: boolean;
      retainOnFailure?: boolean;
      initialSelectedPath?: string | null;
      excludePaths?: ReadonlySet<string>;
    },
  ) => {
    const token = (previewSelectionToken += 1);
    previewSelectionInFlight.value = true;
    const isCurrent = () => token === previewSelectionToken;

    const preserveMedia = options?.preserveMedia ?? false;
    const preservedPath = preserveMedia ? currentPreviewPath.value : null;

    if (!preserveMedia) {
      previewUrl.value = null;
      previewMediaKind.value = null;
      previewDurationSeconds.value = null;
    }

    previewError.value = null;
    previewCandidatePaths.value = buildPreviewCandidates(job, mode).filter((path) => !options?.excludePaths?.has(path));
    previewCandidateIndex.value = -1;
    // Keep the currently displayed path stable while switching sources to avoid
    // badge/copy-path inconsistencies during async backend selection.
    currentPreviewPath.value = preserveMedia ? preservedPath : null;

    const candidates = previewCandidatePaths.value;
    if (!candidates.length) {
      // 没有任何可用路径时直接展示“无预览”占位文案。
      if (!preserveMedia) {
        previewUrl.value = null;
      }
      if (isCurrent()) {
        previewSelectionInFlight.value = false;
      }
      return false;
    }

    let selectedPath: string | null = null;
    const selectAndApply = async () => {
      const tauriMode = hasTauri();

      const preferred = (options?.initialSelectedPath ?? "").trim();
      if (preferred && candidates.includes(preferred)) {
        selectedPath = preferred;
      } else if (tauriMode) {
        // 让后端根据真实文件存在情况挑选首选路径，避免指向已删除/不存在的输出文件。
        selectedPath = await selectPlayableMediaPath(candidates);
      }

      if (!isCurrent()) return false;

      if (!selectedPath && !tauriMode) {
        selectedPath = candidates[0] ?? null;
      }

      if (!selectedPath) {
        if (options?.retainOnFailure) return false;
        previewUrl.value = null;
        previewMediaKind.value = null;
        previewDurationSeconds.value = null;
        currentPreviewPath.value = null;
        if (isCurrent()) {
          previewSelectionInFlight.value = false;
        }
        return false;
      }

      const info = tauriMode
        ? await probeMediaPreviewInfo(selectedPath)
        : { kind: browserPreviewKind(job, selectedPath), durationSeconds: job.mediaInfo?.durationSeconds ?? null };
      if (!isCurrent()) return false;

      const idx = candidates.indexOf(selectedPath);
      previewCandidateIndex.value = idx >= 0 ? idx : 0;
      currentPreviewPath.value = selectedPath;
      previewMediaKind.value = info.kind;
      previewDurationSeconds.value = info.durationSeconds;

      const inferred = inferSourceModeFromSelectedPath(job, selectedPath, mode);
      if (inferred && previewSourceMode.value !== inferred) {
        previewSourceMode.value = inferred;
      }

      const url = buildPreviewUrl(selectedPath);
      previewUrl.value = url;
      return !!url;
    };
    try {
      return await selectAndApply();
    } catch (e) {
      if (!isCurrent()) return false;
      console.error("Failed to select preview media for job:", e);
      if (options?.retainOnFailure) return false;
      previewUrl.value = null;
      previewMediaKind.value = null;
      previewDurationSeconds.value = null;
      currentPreviewPath.value = selectedPath;
      previewError.value = `${t?.("previewFallback.probeFailed") ?? "Unable to inspect preview media"}: ${String(e)}`;
      return false;
    } finally {
      if (isCurrent()) {
        previewSelectionInFlight.value = false;
      }
    }
  };

  const openJobPreviewFromQueue = async (job: TranscodeJob) => {
    const token = ++previewIntentToken;
    previewSelectionToken += 1;
    previewSelectionInFlight.value = true;
    previewSourceSelection.value = "auto";
    nativeErrorFailedPaths.value = [];
    const { mode, selectedPath } = await resolveInitialPreviewSelection(job);
    if (token !== previewIntentToken) return;
    previewSourceMode.value = mode;
    dialogManager.openPreview(job);
    await applyPreviewSelection(job, previewSourceMode.value, { initialSelectedPath: selectedPath });
  };

  const setPreviewSourceMode = async (mode: PreviewSourceMode) => {
    if (previewSourceMode.value === mode) return;
    previewIntentToken += 1;
    previewSourceSelection.value = "manual";
    previewSourceMode.value = mode;
    const job = dialogManager.selectedJob.value;
    if (!job) return;
    await applyPreviewSelection(job, previewSourceMode.value, { preserveMedia: true });
  };

  const closeExpandedPreview = () => {
    previewIntentToken += 1;
    previewSelectionToken += 1;
    previewSelectionInFlight.value = false;
    dialogManager.closePreview();
    previewUrl.value = null;
    previewMediaKind.value = null;
    previewDurationSeconds.value = null;
    previewError.value = null;
    previewCandidatePaths.value = [];
    previewCandidateIndex.value = -1;
    currentPreviewPath.value = null;
    previewSourceMode.value = "output";
    previewSourceSelection.value = "auto";
    nativeErrorFailedPaths.value = [];
  };

  const handleExpandedPreviewError = async () => {
    const errorToken = previewIntentToken;
    if (previewMediaKind.value !== "video") return;
    const job = dialogManager.selectedJob.value;
    if (!job) return;
    if (previewSelectionInFlight.value) return;
    if (previewError.value) return;

    const currentPath = (currentPreviewPath.value ?? "").trim();
    if (currentPath) {
      const next = new Set(nativeErrorFailedPaths.value);
      next.add(currentPath);
      nativeErrorFailedPaths.value = Array.from(next);
    }

    const isInFlight = job.status !== "completed" && job.status !== "failed";
    if (isInFlight) {
      const key = "jobDetail.previewVideoError";
      previewError.value = t?.(key) ?? key;
      return;
    }

    // If the user manually picked a source, keep the selection stable and fall back to frames.
    if (previewSourceSelection.value === "manual") {
      const key = "jobDetail.previewVideoError";
      previewError.value = t?.(key) ?? key;
      return;
    }

    const failed = new Set(nativeErrorFailedPaths.value);
    const inputCandidates = buildPreviewCandidates(job, "input");
    const outputCandidates = buildPreviewCandidates(job, "output");
    const inputPreferred = (inputCandidates[0] ?? "").trim() || null;
    const outputPreferred = (outputCandidates[0] ?? "").trim() || null;

    // Completed/failed jobs default to output. If output fails natively, try input playback.
    if (
      previewSourceMode.value === "output" &&
      inputPreferred &&
      inputPreferred !== currentPath &&
      !failed.has(inputPreferred)
    ) {
      previewError.value = null;
      previewSourceMode.value = "input";
      const retried = await applyPreviewSelection(job, "input", {
        preserveMedia: true,
        retainOnFailure: true,
        excludePaths: failed,
      });
      if (!retried && errorToken === previewIntentToken && previewMediaKind.value === "video") {
        previewSourceMode.value = "output";
        const key = "jobDetail.previewVideoError";
        previewError.value = t?.(key) ?? key;
      }
      return;
    }

    // If native playback still fails, prefer output for frame fallback (when available).
    if (outputPreferred) {
      previewSourceMode.value = "output";
      await applyPreviewSelection(job, "output", { preserveMedia: true });
    }

    if (
      errorToken !== previewIntentToken ||
      dialogManager.selectedJob.value?.id !== job.id ||
      previewMediaKind.value !== "video" ||
      previewSelectionInFlight.value
    )
      return;

    const key = "jobDetail.previewVideoError";
    previewError.value = t?.(key) ?? key;
  };

  const handleExpandedImagePreviewError = () => {
    const key = "jobDetail.previewImageError";
    previewError.value = t?.(key) ?? "";
  };

  const openPreviewInSystemPlayer = async () => {
    const job = dialogManager.selectedJob.value;
    if (!job) return;
    if (!hasTauri()) return;

    const { openPath } = await import("@tauri-apps/plugin-opener");

    const candidates = buildPreviewCandidates(job, previewSourceMode.value);
    if (!candidates.length) return;

    // 当前预览路径（如果有）应当优先使用，其次再让后端根据存在性做一次筛选。
    const mergedCandidates = currentPreviewPath.value ? [currentPreviewPath.value, ...candidates] : candidates.slice();
    const uniqueCandidates = Array.from(new Set(mergedCandidates));

    let path: string | null = null;
    try {
      path = await selectPlayableMediaPath(uniqueCandidates);
    } catch (e) {
      console.error("Failed to select playable path for system player", e);
    }

    if (!path) return;

    try {
      await openPath(path);
    } catch (e) {
      console.error("Failed to open in system player:", e);
    }
  };

  const openBatchDetail = (batch: CompositeBatchCompressTask) => {
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
    previewPath: currentPreviewPath,
    previewIsImage,
    previewMediaKind,
    previewDurationSeconds,
    previewLoading: previewSelectionInFlight,
    previewError,
    previewSourceMode,
    openJobPreviewFromQueue,
    setPreviewSourceMode,
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
