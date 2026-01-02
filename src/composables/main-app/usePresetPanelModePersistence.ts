import { ref, watch, type Ref } from "vue";
import type { AppSettings, PresetSortDirection, PresetSortMode, PresetViewMode } from "@/types";
import { hasTauri } from "@/lib/backend";
import { normalizePresetSortDirection, normalizePresetSortMode, normalizePresetViewMode } from "./presetUiPreferences";
import { getDefaultPresetSortDirection } from "@/lib/presetSorter";

export function usePresetPanelModePersistence(options: {
  presetSortMode: Ref<PresetSortMode>;
  presetSortDirection: Ref<PresetSortDirection>;
  presetViewMode: Ref<PresetViewMode>;
  appSettings: Ref<AppSettings | null>;
  ensureAppSettingsLoaded: () => Promise<void>;
  persistNow: (nextSettings?: AppSettings) => Promise<void>;
}) {
  const { presetSortMode, presetSortDirection, presetViewMode, appSettings, ensureAppSettingsLoaded, persistNow } =
    options;
  const pendingPresetSortMode = ref<PresetSortMode | null>(null);
  const pendingPresetSortDirection = ref<PresetSortDirection | null>(null);
  const pendingPresetViewMode = ref<PresetViewMode | null>(null);
  let pendingPersist: AppSettings | null = null;
  let persistScheduled = false;

  const queuePersist = (nextSettings: AppSettings) => {
    pendingPersist = nextSettings;
    if (persistScheduled) return;
    persistScheduled = true;

    queueMicrotask(() => {
      persistScheduled = false;
      const next = pendingPersist;
      pendingPersist = null;
      if (!next) return;
      void persistNow(next);
    });
  };

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

      const defaultSortDirection = getDefaultPresetSortDirection(nextPresetSortMode);
      const desiredPresetSortDirection =
        pendingPresetSortDirection.value ??
        normalizePresetSortDirection(value.presetSortDirection, defaultSortDirection);
      const nextPresetSortDirection = normalizePresetSortDirection(desiredPresetSortDirection, defaultSortDirection);
      if (nextPresetSortDirection !== presetSortDirection.value) {
        presetSortDirection.value = nextPresetSortDirection;
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
        queuePersist(nextSettings);
      }
      pendingPresetSortMode.value = null;

      const sortDirectionToPersist = pendingPresetSortDirection.value;
      if (sortDirectionToPersist) {
        const directionToPersist = sortDirectionToPersist === defaultSortDirection ? undefined : sortDirectionToPersist;
        if (value.presetSortDirection !== directionToPersist) {
          const nextSettings: AppSettings = { ...value, presetSortDirection: directionToPersist };
          appSettings.value = nextSettings;
          queuePersist(nextSettings);
        }
      }
      pendingPresetSortDirection.value = null;

      const viewModeToPersist = pendingPresetViewMode.value;
      if (viewModeToPersist && value.presetViewMode !== viewModeToPersist) {
        const nextSettings: AppSettings = { ...value, presetViewMode: viewModeToPersist };
        appSettings.value = nextSettings;
        queuePersist(nextSettings);
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
      queuePersist(nextSettings);
    },
    { flush: "post" },
  );

  watch(
    presetSortDirection,
    (nextDirection) => {
      if (!hasTauri()) return;
      pendingPresetSortDirection.value = nextDirection;

      const current = appSettings.value;
      if (!current) {
        void ensureAppSettingsLoaded();
        return;
      }
      const defaultDirection = getDefaultPresetSortDirection(presetSortMode.value);
      const directionToPersist = nextDirection === defaultDirection ? undefined : nextDirection;
      if (current.presetSortDirection === directionToPersist) return;

      const nextSettings: AppSettings = { ...current, presetSortDirection: directionToPersist };
      appSettings.value = nextSettings;
      queuePersist(nextSettings);
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
      queuePersist(nextSettings);
    },
    { flush: "post" },
  );
}
