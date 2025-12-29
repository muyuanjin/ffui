import { ref, watch, type Ref } from "vue";
import type { AppSettings, PresetSortMode, PresetViewMode } from "@/types";
import { hasTauri } from "@/lib/backend";
import { normalizePresetSortMode, normalizePresetViewMode } from "./presetUiPreferences";

export function usePresetPanelModePersistence(options: {
  presetSortMode: Ref<PresetSortMode>;
  presetViewMode: Ref<PresetViewMode>;
  appSettings: Ref<AppSettings | null>;
  ensureAppSettingsLoaded: () => Promise<void>;
  persistNow: (nextSettings?: AppSettings) => Promise<void>;
}) {
  const { presetSortMode, presetViewMode, appSettings, ensureAppSettingsLoaded, persistNow } = options;
  const pendingPresetSortMode = ref<PresetSortMode | null>(null);
  const pendingPresetViewMode = ref<PresetViewMode | null>(null);

  watch(
    () => appSettings.value,
    (value) => {
      if (!hasTauri()) return;
      if (!value) return;

      const desiredPresetSortMode =
        pendingPresetSortMode.value ?? normalizePresetSortMode(value.presetSortMode, presetSortMode.value);
      const nextPresetSortMode = normalizePresetSortMode(desiredPresetSortMode, presetSortMode.value);
      if (nextPresetSortMode !== presetSortMode.value) {
        presetSortMode.value = nextPresetSortMode;
      }

      const desiredPresetViewMode =
        pendingPresetViewMode.value ?? normalizePresetViewMode(value.presetViewMode, presetViewMode.value);
      const nextPresetViewMode = normalizePresetViewMode(desiredPresetViewMode, presetViewMode.value);
      if (nextPresetViewMode !== presetViewMode.value) {
        presetViewMode.value = nextPresetViewMode;
      }

      const sortModeToPersist = pendingPresetSortMode.value;
      if (sortModeToPersist && value.presetSortMode !== sortModeToPersist) {
        const nextSettings: AppSettings = { ...value, presetSortMode: sortModeToPersist };
        appSettings.value = nextSettings;
        void persistNow(nextSettings);
      }
      pendingPresetSortMode.value = null;

      const viewModeToPersist = pendingPresetViewMode.value;
      if (viewModeToPersist && value.presetViewMode !== viewModeToPersist) {
        const nextSettings: AppSettings = { ...value, presetViewMode: viewModeToPersist };
        appSettings.value = nextSettings;
        void persistNow(nextSettings);
      }
      pendingPresetViewMode.value = null;
    },
    { flush: "post" },
  );

  watch(
    presetSortMode,
    (nextMode) => {
      if (!hasTauri()) return;
      pendingPresetSortMode.value = nextMode;

      const current = appSettings.value;
      if (!current) {
        void ensureAppSettingsLoaded();
        return;
      }
      if (current.presetSortMode === nextMode) return;

      const nextSettings: AppSettings = { ...current, presetSortMode: nextMode };
      appSettings.value = nextSettings;
      void persistNow(nextSettings);
    },
    { flush: "post" },
  );

  watch(
    presetViewMode,
    (nextMode) => {
      if (!hasTauri()) return;
      pendingPresetViewMode.value = nextMode;

      const current = appSettings.value;
      if (!current) {
        void ensureAppSettingsLoaded();
        return;
      }
      if (current.presetViewMode === nextMode) return;

      const nextSettings: AppSettings = { ...current, presetViewMode: nextMode };
      appSettings.value = nextSettings;
      void persistNow(nextSettings);
    },
    { flush: "post" },
  );
}
