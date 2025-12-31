import { computed, onMounted, ref, type Ref, type ComputedRef } from "vue";
import type { FFmpegPreset, TranscodeJob, Translate } from "@/types";
import {
  hasTauri,
  loadPresets,
  savePresetOnBackend,
  deletePresetOnBackend,
  reorderPresetsOnBackend,
  enqueueTranscodeJob,
  enqueueTranscodeJobs,
  expandManualJobInputs,
} from "@/lib/backend";
import { INITIAL_PRESETS } from "@/lib/initialPresets";
import { applyPresetStatsDelta, getPresetStatsDeltaFromJob, makeZeroPresetStats } from "@/lib/presetStats";
import { startupNowMs, updateStartupMetrics } from "@/lib/startupMetrics";
import { perfLog } from "@/lib/perfLog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { UseMainAppShellReturn } from "./useMainAppShell";
import type { UseMainAppDialogsReturn } from "./useMainAppDialogs";
import { usePresetLibraryActions, type PresetLibraryActionsReturn } from "./presets/usePresetLibraryActions";
import { ensureManualPresetId, resolveManualPreset } from "./useMainAppQueue.ui";

const isTestEnv =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

let loggedPresetsLoad = false;

export interface UseMainAppPresetsOptions {
  t: Translate;
  locale: Ref<string>;
  presets: Ref<FFmpegPreset[]>;
  presetsLoadedFromBackend: Ref<boolean>;
  manualJobPresetId: Ref<string | null>;
  dialogManager: UseMainAppDialogsReturn["dialogManager"];
  shell?: UseMainAppShellReturn;
}

export interface UseMainAppPresetsReturn extends PresetLibraryActionsReturn {
  manualJobPreset: ComputedRef<FFmpegPreset | null>;
  presetPendingDelete: Ref<FFmpegPreset | null>;
  handleSavePreset: (preset: FFmpegPreset) => Promise<void>;
  handleReorderPresets: (orderedIds: string[]) => Promise<void>;
  handleImportSmartPackConfirmed: (
    presetsToImport: FFmpegPreset[],
    options?: { replaceExisting?: boolean },
  ) => Promise<void>;
  reloadPresets: () => Promise<void>;
  updatePresetStats: (presetId: string, input: number, output: number, timeSeconds: number, frames: number) => void;
  handleCompletedJobFromBackend: (job: TranscodeJob) => void;
  requestDeletePreset: (preset: FFmpegPreset) => void;
  confirmDeletePreset: () => Promise<void>;
  cancelDeletePreset: () => void;
  openPresetEditor: (preset: FFmpegPreset) => void;
  addManualJob: (mode?: "files" | "folder") => Promise<void>;
}

const LEGACY_DEFAULT_PRESET_IDS = new Set(INITIAL_PRESETS.map((preset) => preset.id));

/**
 * Preset list, default preset selection, and delete-confirm dialog wiring.
 *
 * This composable intentionally focuses on preset state; persistence to
 * AppSettings (defaultQueuePresetId) is handled in useMainAppSettings.
 */
export function useMainAppPresets(options: UseMainAppPresetsOptions): UseMainAppPresetsReturn {
  const { presets, presetsLoadedFromBackend, manualJobPresetId, dialogManager, shell, locale } = options;

  // Initialize with local presets so the UI is immediately usable.
  if (presets.value.length === 0) {
    presets.value = [...INITIAL_PRESETS];
  }

  const presetPendingDelete = ref<FFmpegPreset | null>(null);

  const manualJobPreset = computed<FFmpegPreset | null>(() =>
    resolveManualPreset(presets.value, manualJobPresetId.value),
  );

  const ensureManualPresetIdLocal = () => ensureManualPresetId(presets.value, manualJobPresetId);
  ensureManualPresetIdLocal();

  const libraryActions = usePresetLibraryActions({
    locale,
    presets,
    ensureManualPresetId: ensureManualPresetIdLocal,
    shell,
  });

  const stableStringify = (value: unknown): string => {
    if (value === null) return "null";
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(value);
    if (t !== "object") return JSON.stringify(null);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",");
    return `{${body}}`;
  };

  const transcodeConfigSignature = (preset: FFmpegPreset): string => {
    return stableStringify({
      global: preset.global ?? null,
      input: preset.input ?? null,
      mapping: preset.mapping ?? null,
      video: preset.video ?? null,
      audio: preset.audio ?? null,
      filters: preset.filters ?? null,
      subtitles: preset.subtitles ?? null,
      container: preset.container ?? null,
      hardware: preset.hardware ?? null,
      advancedEnabled: preset.advancedEnabled ?? false,
      ffmpegTemplate: preset.ffmpegTemplate ?? null,
    });
  };

  const shouldResetPresetStats = (prev: FFmpegPreset, next: FFmpegPreset): boolean => {
    return transcodeConfigSignature(prev) !== transcodeConfigSignature(next);
  };

  const updatePresetStats = (presetId: string, input: number, output: number, timeSeconds: number, frames: number) => {
    presets.value = applyPresetStatsDelta(presets.value, presetId, input, output, timeSeconds, frames);
  };

  const applyLocalStatsUpdateFromJob = (job: TranscodeJob) => {
    const delta = getPresetStatsDeltaFromJob(job);
    if (!delta) return;
    updatePresetStats(delta.presetId, delta.inputSizeMB, delta.outputSizeMB, delta.timeSeconds, delta.frames);
  };

  const handleCompletedJobFromBackend = (job: TranscodeJob) => {
    // 在 Tauri 环境下，优先从后端加载最新的预设统计信息，确保卡片底部统计与
    // 实际生产数据一致（由 Rust 端基于真实输入/输出体积与耗时累计）。
    if (hasTauri()) {
      void (async () => {
        try {
          const loaded = await loadPresets();
          if (Array.isArray(loaded) && loaded.length > 0) {
            presets.value = loaded;
            ensureManualPresetIdLocal();
            return;
          }
        } catch (e) {
          console.error("Failed to refresh presets stats from backend:", e);
        }

        // 后端加载失败时退回到前端本地累加逻辑，至少保证当前会话内的统计是连贯的。
        applyLocalStatsUpdateFromJob(job);
      })();
      return;
    }

    // 非 Tauri / 测试环境下保持原有的本地统计行为，方便单元测试和纯网页模式演示。
    applyLocalStatsUpdateFromJob(job);
  };

  const reloadPresets = async () => {
    if (!hasTauri()) return;
    try {
      const loaded = await loadPresets();
      if (Array.isArray(loaded) && loaded.length > 0) {
        presets.value = loaded;
        ensureManualPresetIdLocal();
      }
    } catch (error) {
      console.error("Failed to reload presets from backend:", error);
    }
  };

  const handleSavePreset = async (preset: FFmpegPreset) => {
    const idx = presets.value.findIndex((p) => p.id === preset.id);
    const existing = idx >= 0 ? presets.value[idx] : null;
    const nextStats =
      existing == null
        ? preset.stats
        : shouldResetPresetStats(existing, preset)
          ? makeZeroPresetStats()
          : existing.stats;
    const normalizedPreset: FFmpegPreset = { ...preset, stats: nextStats };
    if (idx >= 0) {
      presets.value.splice(idx, 1, normalizedPreset);
    } else {
      presets.value.push(normalizedPreset);
    }
    ensureManualPresetIdLocal();

    dialogManager.closeWizard();
    dialogManager.closeParameterPanel();

    if (hasTauri()) {
      try {
        await savePresetOnBackend(normalizedPreset);
      } catch (e) {
        console.error("Failed to save preset to backend:", e);
      }
    }

    // When saving from wizard, jump the user into the preset tab for clarity.
    if (shell) {
      shell.activeTab.value = "presets";
    }
  };

  const handleReorderPresets = async (orderedIds: string[]) => {
    // Reorder local state to match the provided order (stable by id map)
    const idToIndex = new Map(orderedIds.map((id, i) => [id, i]));
    const maxIdx = orderedIds.length;
    presets.value = [...presets.value].sort((a, b) => {
      const idxA = idToIndex.get(a.id) ?? maxIdx;
      const idxB = idToIndex.get(b.id) ?? maxIdx;
      return idxA - idxB;
    });

    // Persist to backend
    if (hasTauri()) {
      try {
        const updated = await reorderPresetsOnBackend(orderedIds);
        if (Array.isArray(updated) && updated.length > 0) {
          // 后端返回最新顺序（含统计），用其覆盖本地，避免“回弹”。
          presets.value = updated;
        }
      } catch (e) {
        console.error("Failed to reorder presets on backend:", e);
      }
    }
  };

  const requestDeletePreset = (preset: FFmpegPreset) => {
    presetPendingDelete.value = preset;
  };

  const confirmDeletePreset = async () => {
    const preset = presetPendingDelete.value;
    if (!preset) return;
    const idx = presets.value.findIndex((p) => p.id === preset.id);
    if (idx >= 0) presets.value.splice(idx, 1);
    presetPendingDelete.value = null;

    if (hasTauri()) {
      try {
        await deletePresetOnBackend(preset.id);
      } catch (e) {
        console.error("Failed to delete preset from backend:", e);
      }
    }

    ensureManualPresetIdLocal();
  };

  const cancelDeletePreset = () => {
    presetPendingDelete.value = null;
  };

  const openPresetEditor = (preset: FFmpegPreset) => {
    dialogManager.openParameterPanel(preset);
  };

  const addManualJob = async (mode: "files" | "folder" = "files") => {
    if (shell) {
      shell.activeTab.value = "queue";
    }

    if (!hasTauri()) return;

    try {
      const selected = await openDialog({
        multiple: true,
        directory: mode === "folder",
        recursive: mode === "folder",
      });

      if (!selected) return;
      const selectedPaths = (Array.isArray(selected) ? selected : [selected]).filter(
        (p): p is string => typeof p === "string" && p.length > 0,
      );
      if (selectedPaths.length === 0) return;

      const expanded = await expandManualJobInputs(selectedPaths, { recursive: true });
      if (!Array.isArray(expanded) || expanded.length === 0) return;

      const preset = manualJobPreset.value ?? presets.value[0];
      if (!preset) return;

      if (expanded.length === 1) {
        await enqueueTranscodeJob({
          filename: expanded[0],
          jobType: "video",
          source: "manual",
          originalSizeMb: 0,
          presetId: preset.id,
        });
        return;
      }

      await enqueueTranscodeJobs({
        filenames: expanded,
        jobType: "video",
        source: "manual",
        originalSizeMb: 0,
        presetId: preset.id,
      });
    } catch (e) {
      console.error("Failed to add manual job:", e);
    }
  };

  const handleImportSmartPackConfirmed = async (
    presetsToImport: FFmpegPreset[],
    options?: { replaceExisting?: boolean },
  ) => {
    if (!Array.isArray(presetsToImport) || presetsToImport.length === 0) return;

    const dedupedById = new Map<string, FFmpegPreset>();
    for (const preset of presetsToImport) {
      if (!dedupedById.has(preset.id)) {
        // 导入时标记为智能推荐预设
        dedupedById.set(preset.id, { ...preset, isSmartPreset: true });
      }
    }
    const selectedPresets = Array.from(dedupedById.values());
    const selectedIds = new Set(selectedPresets.map((preset) => preset.id));

    const onlyLegacyDefaults =
      presets.value.length === LEGACY_DEFAULT_PRESET_IDS.size &&
      presets.value.every((preset) => LEGACY_DEFAULT_PRESET_IDS.has(preset.id));

    const shouldReplaceExisting = options?.replaceExisting || onlyLegacyDefaults;

    if (shouldReplaceExisting) {
      const idsToRemove = presets.value.filter((preset) => !selectedIds.has(preset.id)).map((preset) => preset.id);

      let latestPresets = selectedPresets;

      if (hasTauri()) {
        // 先删掉旧的（尤其是 legacy 默认），再保存用户选择的，保持后端状态一致。
        for (const id of idsToRemove) {
          try {
            const updated = await deletePresetOnBackend(id);
            if (Array.isArray(updated) && updated.length > 0) {
              latestPresets = updated.filter((preset) => selectedIds.has(preset.id));
            }
          } catch (e) {
            console.error("Failed to delete legacy preset on backend:", e);
          }
        }

        for (const preset of selectedPresets) {
          try {
            const updated = await savePresetOnBackend(preset);
            if (Array.isArray(updated) && updated.length > 0) {
              latestPresets = updated;
            }
          } catch (e) {
            console.error("Failed to save smart-pack preset to backend:", e);
          }
        }
      }

      presets.value = latestPresets;
      ensureManualPresetIdLocal();

      if (shell) {
        shell.activeTab.value = "presets";
      }
      return;
    }

    for (const preset of presetsToImport) {
      const idx = presets.value.findIndex((p) => p.id === preset.id);
      if (idx >= 0) {
        presets.value.splice(idx, 1, preset);
      } else {
        presets.value.push(preset);
      }
      if (hasTauri()) {
        try {
          await savePresetOnBackend(preset);
        } catch (e) {
          console.error("Failed to save smart-pack preset to backend:", e);
        }
      }
    }

    ensureManualPresetIdLocal();

    if (shell) {
      shell.activeTab.value = "presets";
    }
  };

  onMounted(async () => {
    if (!hasTauri()) return;
    if (presetsLoadedFromBackend.value) return;

    try {
      const startedAt = startupNowMs();
      const loaded = await loadPresets();
      const elapsedMs = startupNowMs() - startedAt;

      if (!isTestEnv && (!loggedPresetsLoad || elapsedMs >= 200)) {
        loggedPresetsLoad = true;
        updateStartupMetrics({ loadPresetsMs: elapsedMs });
        if (typeof performance !== "undefined" && "mark" in performance) {
          performance.mark("presets_loaded");
        }
        perfLog(`[perf] get_presets: ${elapsedMs.toFixed(1)}ms`);
      }
      if (Array.isArray(loaded) && loaded.length > 0) {
        presets.value = loaded;
      }
      presetsLoadedFromBackend.value = true;
      ensureManualPresetIdLocal();
    } catch (e) {
      console.error("Failed to load presets:", e);
    }
  });

  return {
    ...libraryActions,
    manualJobPreset,
    presetPendingDelete,
    handleSavePreset,
    handleReorderPresets,
    handleImportSmartPackConfirmed,
    reloadPresets,
    updatePresetStats,
    handleCompletedJobFromBackend,
    requestDeletePreset,
    confirmDeletePreset,
    cancelDeletePreset,
    openPresetEditor,
    addManualJob,
  };
}

export default useMainAppPresets;
