import { computed, ref, watch, type Ref, type ComputedRef } from "vue";
import type { FFmpegPreset, TranscodeJob, AppSettings } from "@/types";
import { hasTauri, loadPresets, savePresetOnBackend, deletePresetOnBackend } from "@/lib/backend";
import { INITIAL_PRESETS } from "@/lib/initialPresets";
import { applyPresetStatsDelta, getPresetStatsDeltaFromJob } from "@/lib/presetStats";

// ----- Composable -----

export interface UsePresetManagementOptions {
  /** App settings ref (for default preset persistence). */
  appSettings: Ref<AppSettings | null>;
  /** Smart config ref (to update when preset is deleted). */
  smartConfigVideoPresetId: Ref<string>;
  /** Active tab ref. */
  activeTab: Ref<string>;
}

export interface UsePresetManagementReturn {
  // ----- State -----
  /** List of presets. */
  presets: Ref<FFmpegPreset[]>;
  /** Whether presets have been loaded from backend. */
  presetsLoadedFromBackend: Ref<boolean>;
  /** Currently editing preset. */
  editingPreset: Ref<FFmpegPreset | null>;
  /** Preset pending deletion confirmation. */
  presetPendingDelete: Ref<FFmpegPreset | null>;
  /** Manual job preset ID. */
  manualJobPresetId: Ref<string | null>;
  /** Whether wizard dialog is visible. */
  showWizard: Ref<boolean>;
  /** Whether parameter panel is visible. */
  showParameterPanel: Ref<boolean>;

  // ----- Computed -----
  /** The currently selected preset for manual jobs. */
  manualJobPreset: ComputedRef<FFmpegPreset | null>;

  // ----- Methods -----
  /** Ensure presets are loaded from backend. */
  ensurePresetsLoaded: () => Promise<void>;
  /** Save a preset. */
  handleSavePreset: (preset: FFmpegPreset) => Promise<void>;
  /** Open wizard for new preset. */
  openNewPresetWizard: () => void;
  /** Open wizard to edit a preset. */
  openEditPresetWizard: (preset: FFmpegPreset) => void;
  /** Open parameter panel from wizard. */
  openPresetPanelFromWizard: (preset: FFmpegPreset) => void;
  /** Open wizard from parameter panel. */
  openPresetWizardFromPanel: (preset: FFmpegPreset) => void;
  /** Request deletion of a preset. */
  requestDeletePreset: (preset: FFmpegPreset) => void;
  /** Confirm deletion of pending preset. */
  confirmDeletePreset: () => Promise<void>;
  /** Cancel deletion. */
  cancelDeletePreset: () => void;
  /** Get average compression ratio for a preset. */
  getPresetAvgRatio: (preset: FFmpegPreset) => number | null;
  /** Get average speed for a preset. */
  getPresetAvgSpeed: (preset: FFmpegPreset) => number | null;
  /** Update preset stats after job completion. */
  updatePresetStats: (presetId: string, input: number, output: number, timeSeconds: number, frames: number) => void;
  /** Handle completed job (update preset stats). */
  handleCompletedJobFromBackend: (job: TranscodeJob) => void;
}

/**
 * Composable for preset management.
 */
export function usePresetManagement(options: UsePresetManagementOptions): UsePresetManagementReturn {
  const { appSettings, smartConfigVideoPresetId, activeTab } = options;

  // ----- State -----
  const presets = ref<FFmpegPreset[]>([...INITIAL_PRESETS]);
  const presetsLoadedFromBackend = ref(false);
  const editingPreset = ref<FFmpegPreset | null>(null);
  const presetPendingDelete = ref<FFmpegPreset | null>(null);
  const manualJobPresetId = ref<string | null>(null);
  const showWizard = ref(false);
  const showParameterPanel = ref(false);

  // ----- Computed -----
  const manualJobPreset = computed<FFmpegPreset | null>(() => {
    const list = presets.value;
    if (!list || list.length === 0) return null;
    const id = manualJobPresetId.value;
    if (!id) return list[0];
    return list.find((p) => p.id === id) ?? list[0];
  });

  // ----- Watchers -----
  // Keep manualJobPresetId in sync when presets change.
  watch(
    presets,
    (list) => {
      if (!list || list.length === 0) {
        manualJobPresetId.value = null;
        return;
      }
      if (!manualJobPresetId.value || !list.some((p) => p.id === manualJobPresetId.value)) {
        manualJobPresetId.value = list[0].id;
      }
    },
    { immediate: true },
  );

  // Persist the user's default queue preset selection into AppSettings.
  watch(
    manualJobPresetId,
    (id) => {
      if (!hasTauri()) return;
      if (!id) return;

      const current = appSettings.value;
      if (!current) return;
      if (current.defaultQueuePresetId === id) return;
      // Let useAppSettings handle persistence & saved snapshot tracking.
      appSettings.value = {
        ...current,
        defaultQueuePresetId: id,
      };
    },
    { flush: "post" },
  );

  // ----- Methods -----
  const ensurePresetsLoaded = async () => {
    if (!hasTauri()) return;
    if (presetsLoadedFromBackend.value) return;

    try {
      const loaded = await loadPresets();
      if (Array.isArray(loaded) && loaded.length > 0) {
        presets.value = loaded;
      }
      presetsLoadedFromBackend.value = true;
    } catch (error) {
      console.error("Failed to load presets from backend", error);
    }
  };

  const handleSavePreset = async (preset: FFmpegPreset) => {
    let nextPresets: FFmpegPreset[];

    if (hasTauri()) {
      try {
        // Persist to the Tauri backend so the transcoding engine can resolve
        // this preset id when processing queued jobs.
        nextPresets = await savePresetOnBackend(preset);
      } catch (error) {
        console.error("Failed to save preset on backend, falling back to local state", error);
        nextPresets = editingPreset.value
          ? presets.value.map((p) => (p.id === preset.id ? preset : p))
          : [...presets.value, preset];
      }
    } else {
      nextPresets = editingPreset.value
        ? presets.value.map((p) => (p.id === preset.id ? preset : p))
        : [...presets.value, preset];
    }

    presets.value = nextPresets;
    showWizard.value = false;
    showParameterPanel.value = false;
    editingPreset.value = null;
    activeTab.value = "presets";
  };

  const openNewPresetWizard = () => {
    editingPreset.value = null;
    showWizard.value = true;
    showParameterPanel.value = false;
  };

  const openEditPresetWizard = (preset: FFmpegPreset) => {
    editingPreset.value = preset;
    showWizard.value = false;
    showParameterPanel.value = true;
  };

  const openPresetPanelFromWizard = (preset: FFmpegPreset) => {
    editingPreset.value = preset;
    showWizard.value = false;
    showParameterPanel.value = true;
  };

  const openPresetWizardFromPanel = (preset: FFmpegPreset) => {
    editingPreset.value = preset;
    showParameterPanel.value = false;
    showWizard.value = true;
  };

  const requestDeletePreset = (preset: FFmpegPreset) => {
    presetPendingDelete.value = preset;
  };

  const confirmDeletePreset = async () => {
    const target = presetPendingDelete.value;
    if (!target) return;

    let nextPresets: FFmpegPreset[];

    if (hasTauri()) {
      try {
        // Keep backend presets in sync so Batch Compress and queued jobs never see
        // a stale preset id that no longer exists.
        nextPresets = await deletePresetOnBackend(target.id);
      } catch (error) {
        console.error("Failed to delete preset on backend, falling back to local state", error);
        nextPresets = presets.value.filter((p) => p.id !== target.id);
      }
    } else {
      nextPresets = presets.value.filter((p) => p.id !== target.id);
    }

    presets.value = nextPresets;

    // If the current batch compress default preset was deleted, fall back to the first or clear.
    if (smartConfigVideoPresetId.value === target.id) {
      smartConfigVideoPresetId.value = presets.value[0]?.id ?? "";
    }

    presetPendingDelete.value = null;
  };

  const cancelDeletePreset = () => {
    presetPendingDelete.value = null;
  };

  const getPresetAvgRatio = (preset: FFmpegPreset): number | null => {
    const input = preset.stats.totalInputSizeMB;
    const output = preset.stats.totalOutputSizeMB;
    if (!input || !output || input <= 0 || output <= 0) return null;
    // 与 Batch Compress 逻辑保持一致：压缩率 = 输出体积 / 输入体积 * 100
    return (output / input) * 100;
  };

  const getPresetAvgSpeed = (preset: FFmpegPreset): number | null => {
    const input = preset.stats.totalInputSizeMB;
    const time = preset.stats.totalTimeSeconds;
    if (!input || !time || time <= 0) return null;
    return input / time;
  };

  const updatePresetStats = (presetId: string, input: number, output: number, timeSeconds: number, frames: number) => {
    presets.value = applyPresetStatsDelta(presets.value, presetId, input, output, timeSeconds, frames);
  };

  const handleCompletedJobFromBackend = (job: TranscodeJob) => {
    const delta = getPresetStatsDeltaFromJob(job);
    if (!delta) return;
    updatePresetStats(delta.presetId, delta.inputSizeMB, delta.outputSizeMB, delta.timeSeconds, delta.frames);
  };

  return {
    // State
    presets,
    presetsLoadedFromBackend,
    editingPreset,
    presetPendingDelete,
    manualJobPresetId,
    showWizard,
    showParameterPanel,

    // Computed
    manualJobPreset,

    // Methods
    ensurePresetsLoaded,
    handleSavePreset,
    openNewPresetWizard,
    openEditPresetWizard,
    openPresetPanelFromWizard,
    openPresetWizardFromPanel,
    requestDeletePreset,
    confirmDeletePreset,
    cancelDeletePreset,
    getPresetAvgRatio,
    getPresetAvgSpeed,
    updatePresetStats,
    handleCompletedJobFromBackend,
  };
}

export default usePresetManagement;
