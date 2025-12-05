import { computed, onMounted, ref, type Ref, type ComputedRef } from "vue";
import type { FFmpegPreset } from "@/types";
import {
  hasTauri,
  loadPresets,
  savePresetOnBackend,
  deletePresetOnBackend,
  enqueueTranscodeJob,
} from "@/lib/backend";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { UseMainAppShellReturn } from "./useMainAppShell";
import type { UseMainAppDialogsReturn } from "./useMainAppDialogs";

export interface UseMainAppPresetsOptions {
  t: (key: string) => string;
  presets: Ref<FFmpegPreset[]>;
  presetsLoadedFromBackend: Ref<boolean>;
  manualJobPresetId: Ref<string | null>;
  dialogManager: UseMainAppDialogsReturn["dialogManager"];
  shell?: UseMainAppShellReturn;
}

export interface UseMainAppPresetsReturn {
  manualJobPreset: ComputedRef<FFmpegPreset | null>;
  presetPendingDelete: Ref<FFmpegPreset | null>;
  handleSavePreset: (preset: FFmpegPreset) => Promise<void>;
  requestDeletePreset: (preset: FFmpegPreset) => void;
  confirmDeletePreset: () => Promise<void>;
  cancelDeletePreset: () => void;
  openPresetEditor: (preset: FFmpegPreset) => void;
  addManualJob: () => Promise<void>;
}

const INITIAL_PRESETS: FFmpegPreset[] = [
  {
    id: "p1",
    name: "Universal 1080p",
    description: "x264 Medium CRF 23. Standard for web.",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
    audio: { codec: "copy" },
    filters: { scale: "-2:1080" },
    stats: {
      usageCount: 5,
      totalInputSizeMB: 2500,
      totalOutputSizeMB: 800,
      totalTimeSeconds: 420,
    },
  },
  {
    id: "p2",
    name: "Archive Master",
    description: "x264 Slow CRF 18. Near lossless.",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 18, preset: "slow" },
    audio: { codec: "copy" },
    filters: {},
    stats: {
      usageCount: 2,
      totalInputSizeMB: 5000,
      totalOutputSizeMB: 3500,
      totalTimeSeconds: 1200,
    },
  },
];

/**
 * Preset list, default preset selection, and delete-confirm dialog wiring.
 *
 * This composable intentionally focuses on preset state; persistence to
 * AppSettings (defaultQueuePresetId) is handled in useMainAppSettings.
 */
export function useMainAppPresets(options: UseMainAppPresetsOptions): UseMainAppPresetsReturn {
  const { presets, presetsLoadedFromBackend, manualJobPresetId, dialogManager, shell } = options;

  // Initialize with local presets so the UI is immediately usable.
  if (presets.value.length === 0) {
    presets.value = [...INITIAL_PRESETS];
  }

  const presetPendingDelete = ref<FFmpegPreset | null>(null);

  const manualJobPreset = computed<FFmpegPreset | null>(() => {
    const list = presets.value;
    if (!list || list.length === 0) return null;
    const id = manualJobPresetId.value;
    if (!id) return list[0];
    return list.find((p) => p.id === id) ?? list[0];
  });

  // Ensure manualJobPresetId always points at an existing preset.
  const ensureManualPresetId = () => {
    const list = presets.value;
    if (!list || list.length === 0) {
      manualJobPresetId.value = null;
      return;
    }
    if (!manualJobPresetId.value || !list.some((p) => p.id === manualJobPresetId.value)) {
      manualJobPresetId.value = list[0].id;
    }
  };

  ensureManualPresetId();

  const handleSavePreset = async (preset: FFmpegPreset) => {
    const idx = presets.value.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
      presets.value.splice(idx, 1, preset);
    } else {
      presets.value.push(preset);
    }
    ensureManualPresetId();

    dialogManager.closeWizard();
    dialogManager.closeParameterPanel();

    if (hasTauri()) {
      try {
        await savePresetOnBackend(preset);
      } catch (e) {
        console.error("Failed to save preset to backend:", e);
      }
    }

    // When saving from wizard, jump the user into the preset tab for clarity.
    if (shell) {
      shell.activeTab.value = "presets";
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

    ensureManualPresetId();
  };

  const cancelDeletePreset = () => {
    presetPendingDelete.value = null;
  };

  const openPresetEditor = (preset: FFmpegPreset) => {
    dialogManager.openParameterPanel(preset);
  };

  const addManualJob = async () => {
    if (shell) {
      shell.activeTab.value = "queue";
    }

    if (!hasTauri()) return;

    try {
      // DEBUG_MANUAL_JOB: trace manual job flow in tests
      // console.debug("[MainAppPresets] addManualJob start, presetId=", manualJobPresetId.value);
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Video",
            extensions: ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"],
          },
        ],
      });

      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;

      const preset = manualJobPreset.value ?? presets.value[0];
      if (!preset) return;

      await enqueueTranscodeJob({
        filename: path as string,
        jobType: "video",
        source: "manual",
        originalSizeMb: 0,
        presetId: preset.id,
      });
    } catch (e) {
      console.error("Failed to add manual job:", e);
    }
  };

  onMounted(async () => {
    if (!hasTauri()) return;
    if (presetsLoadedFromBackend.value) return;

    try {
      const loaded = await loadPresets();
      if (Array.isArray(loaded) && loaded.length > 0) {
        presets.value = loaded;
      }
      presetsLoadedFromBackend.value = true;
      ensureManualPresetId();
    } catch (e) {
      console.error("Failed to load presets:", e);
    }
  });

  return {
    manualJobPreset,
    presetPendingDelete,
    handleSavePreset,
    requestDeletePreset,
    confirmDeletePreset,
    cancelDeletePreset,
    openPresetEditor,
    addManualJob,
  };
}

export default useMainAppPresets;
