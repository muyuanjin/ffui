import { watch, type Ref } from "vue";
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
  let pendingSortMode: PresetSortMode | null = null;
  let pendingSortDirection: PresetSortDirection | null = null;
  let pendingViewMode: PresetViewMode | null = null;
  let restoring = false;
  let persistScheduled = false;

  const queuePersist = () => {
    if (persistScheduled) return;
    persistScheduled = true;
    queueMicrotask(() => {
      persistScheduled = false;
      const current = appSettings.value;
      if (current) void persistNow(current);
    });
  };

  const restoreAndApply = (current: AppSettings | null) => {
    if (!hasTauri() || !current) return;
    const mode = pendingSortMode ?? normalizePresetSortMode(current.presetSortMode, presetSortMode.value);
    const defaultDirection = getDefaultPresetSortDirection(mode);
    const direction =
      pendingSortDirection ?? normalizePresetSortDirection(current.presetSortDirection, defaultDirection);
    const view = pendingViewMode ?? normalizePresetViewMode(current.presetViewMode, presetViewMode.value);
    const next: AppSettings = { ...current };
    if (pendingSortMode !== null) next.presetSortMode = mode;
    if (pendingSortDirection !== null)
      next.presetSortDirection = direction === defaultDirection ? undefined : direction;
    if (pendingViewMode !== null) next.presetViewMode = view;
    pendingSortMode = null;
    pendingSortDirection = null;
    pendingViewMode = null;
    restoring = true;
    presetSortMode.value = mode;
    presetSortDirection.value = direction;
    presetViewMode.value = view;
    restoring = false;
    if (
      next.presetSortMode !== current.presetSortMode ||
      next.presetSortDirection !== current.presetSortDirection ||
      next.presetViewMode !== current.presetViewMode
    ) {
      appSettings.value = next;
      queuePersist();
    }
  };

  watch(() => appSettings.value, restoreAndApply, { flush: "sync", immediate: true });
  watch(
    [presetSortMode, presetSortDirection, presetViewMode],
    ([mode, direction, view], [previousMode, previousDirection, previousView]) => {
      if (!hasTauri() || restoring) return;
      if (mode !== previousMode) pendingSortMode = mode;
      if (direction !== previousDirection) pendingSortDirection = direction;
      if (view !== previousView) pendingViewMode = view;
      const current = appSettings.value;
      if (!current) {
        void ensureAppSettingsLoaded();
        return;
      }
      restoreAndApply(current);
    },
    { flush: "sync" },
  );
}
