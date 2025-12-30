import { computed, ref, type ComputedRef, type Ref } from "vue";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyToClipboard } from "@/lib/copyToClipboard";
import { readFromClipboard } from "@/lib/readFromClipboard";
import { parseJsonAsync, stringifyJsonAsync } from "@/lib/asyncJson";
import {
  deletePresetOnBackend,
  exportPresetsBundle,
  hasTauri,
  readPresetsBundle,
  savePresetOnBackend,
} from "@/lib/backend";
import { getPresetCommandPreview, normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";
import type { FFmpegPreset } from "@/types";
import { quarantinePresetIfInvalid } from "@/lib/presetEditorContract/presetValidator";
import type { UseMainAppShellReturn } from "../useMainAppShell";

export interface PresetLibraryActionsOptions {
  locale: Ref<string>;
  presets: Ref<FFmpegPreset[]>;
  ensureManualPresetId: () => void;
  shell?: UseMainAppShellReturn;
}

export interface PresetLibraryActionsReturn {
  presetsPendingBatchDelete: ComputedRef<FFmpegPreset[]>;
  requestBatchDeletePresets: (presetIds: string[]) => void;
  confirmBatchDeletePresets: () => Promise<void>;
  cancelBatchDeletePresets: () => void;
  duplicatePreset: (sourcePreset: FFmpegPreset) => Promise<void>;
  importPresetsBundleFromFile: () => Promise<void>;
  importPresetsBundleFromClipboard: () => Promise<void>;
  importPresetsCandidates: (presetsToImport: FFmpegPreset[]) => Promise<void>;
  exportSelectedPresetsBundleToFile: (presetIds: string[]) => Promise<void>;
  exportSelectedPresetsBundleToClipboard: (presetIds: string[]) => Promise<void>;
  exportSelectedPresetsTemplateCommandsToClipboard: (presetIdsInDisplayOrder: string[]) => Promise<void>;
  exportPresetToFile: (preset: FFmpegPreset) => Promise<void>;
}

const makeZeroStats = (): FFmpegPreset["stats"] => ({
  usageCount: 0,
  totalInputSizeMB: 0,
  totalOutputSizeMB: 0,
  totalTimeSeconds: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const generateUniquePresetId = (existingIds: Set<string>): string => {
  const tryRandom = () => {
    const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return `preset-${cryptoObj.randomUUID()}`;
    }
    const rand = Math.random().toString(16).slice(2);
    return `preset-${Date.now().toString(16)}-${rand}`;
  };

  for (let i = 0; i < 20; i += 1) {
    const candidate = tryRandom();
    if (!existingIds.has(candidate)) return candidate;
  }
  const baseTime = Date.now();
  let counter = 1;
  while (existingIds.has(`preset-${baseTime}-${counter}`)) counter += 1;
  return `preset-${baseTime}-${counter}`;
};

const generateCopyName = (baseName: string, existingNames: Set<string>, locale: string): string => {
  const isZh = String(locale).startsWith("zh");
  const normalized = String(baseName ?? "").trim() || (isZh ? "未命名预设" : "Untitled Preset");
  const suffix = isZh ? "（副本）" : " (Copy)";
  const suffixWithNumber = (n: number) => (isZh ? `（副本 ${n}）` : ` (Copy ${n})`);

  const firstCandidate = `${normalized}${suffix}`;
  if (!existingNames.has(firstCandidate)) return firstCandidate;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${normalized}${suffixWithNumber(n)}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return firstCandidate;
};

const dedupeImportedName = (baseName: string, existingNames: Set<string>, locale: string): string => {
  const isZh = String(locale).startsWith("zh");
  const normalized = String(baseName ?? "").trim() || (isZh ? "未命名预设" : "Untitled Preset");
  if (!existingNames.has(normalized)) return normalized;
  return generateCopyName(normalized, existingNames, locale);
};

const toSafeFilenameSegment = (value: string): string => {
  const raw = String(value ?? "").trim();
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  const normalized = cleaned.length > 0 ? cleaned : "preset";
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return reserved.test(normalized) ? `${normalized}_` : normalized;
};

let cachedAppVersion: string | null = null;
const getAppVersionBestEffort = async (): Promise<string> => {
  if (cachedAppVersion && cachedAppVersion.trim().length > 0) return cachedAppVersion;
  if (!hasTauri()) return "0.0.0";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const version = await getVersion();
    if (typeof version === "string" && version.trim().length > 0) {
      cachedAppVersion = version.trim();
    }
  } catch (e) {
    console.error("Failed to load app version for preset bundle:", e);
  }
  return cachedAppVersion ?? "0.0.0";
};

export function usePresetLibraryActions(options: PresetLibraryActionsOptions): PresetLibraryActionsReturn {
  const { presets, ensureManualPresetId, shell, locale } = options;

  const presetIdsPendingBatchDelete = ref<string[] | null>(null);

  const presetsPendingBatchDelete = computed<FFmpegPreset[]>(() => {
    const ids = presetIdsPendingBatchDelete.value;
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const selected = new Set(ids);
    return presets.value.filter((preset) => selected.has(preset.id));
  });

  const requestBatchDeletePresets = (presetIds: string[]) => {
    const normalized = (presetIds ?? []).filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    presetIdsPendingBatchDelete.value = normalized.length > 0 ? normalized : null;
  };

  const confirmBatchDeletePresets = async () => {
    const ids = presetIdsPendingBatchDelete.value;
    if (!Array.isArray(ids) || ids.length === 0) return;
    const selected = new Set(ids);
    presetIdsPendingBatchDelete.value = null;

    presets.value = presets.value.filter((preset) => !selected.has(preset.id));

    if (hasTauri()) {
      let latest: FFmpegPreset[] | null = null;
      for (const id of ids) {
        try {
          const updated = await deletePresetOnBackend(id);
          if (Array.isArray(updated)) {
            latest = updated;
          }
        } catch (e) {
          console.error("Failed to batch-delete preset from backend:", e);
        }
      }
      if (Array.isArray(latest)) {
        presets.value = latest;
      }
    }

    ensureManualPresetId();
  };

  const cancelBatchDeletePresets = () => {
    presetIdsPendingBatchDelete.value = null;
  };

  const duplicatePreset = async (sourcePreset: FFmpegPreset) => {
    const existingIds = new Set(presets.value.map((p) => p.id));
    const existingNames = new Set(presets.value.map((p) => p.name));
    const nextPreset: FFmpegPreset = {
      ...sourcePreset,
      id: generateUniquePresetId(existingIds),
      name: generateCopyName(sourcePreset.name, existingNames, locale.value),
      stats: makeZeroStats(),
      isSmartPreset: false,
    };

    presets.value = [...presets.value, nextPreset];
    ensureManualPresetId();

    if (!hasTauri()) return;
    try {
      const updated = await savePresetOnBackend(nextPreset);
      if (Array.isArray(updated) && updated.length > 0) {
        presets.value = updated;
        ensureManualPresetId();
      }
    } catch (e) {
      console.error("Failed to duplicate preset on backend:", e);
    }
  };

  const importPresetsCore = async (incomingPresets: unknown) => {
    const incoming = Array.isArray(incomingPresets) ? incomingPresets : [];
    if (incoming.length === 0) return;

    const existingIds = new Set(presets.value.map((p) => p.id));
    const existingNames = new Set(presets.value.map((p) => p.name));
    const normalizedPresets: FFmpegPreset[] = [];

    for (const presetValue of incoming) {
      if (!isRecord(presetValue)) continue;
      const preset = presetValue as Partial<FFmpegPreset> & Record<string, unknown>;
      const newId = generateUniquePresetId(existingIds);
      existingIds.add(newId);
      const newName = dedupeImportedName(
        typeof preset.name === "string" ? preset.name : "",
        existingNames,
        locale.value,
      );
      existingNames.add(newName);
      const basePreset = preset as FFmpegPreset;
      const validated = quarantinePresetIfInvalid(basePreset as FFmpegPreset);
      normalizedPresets.push({
        ...validated.preset,
        id: newId,
        name: newName,
        stats: makeZeroStats(),
        isSmartPreset: false,
      });
    }

    if (normalizedPresets.length === 0) return;

    let latest: FFmpegPreset[] | null = null;
    if (hasTauri()) {
      for (const preset of normalizedPresets) {
        try {
          const updated = await savePresetOnBackend(preset);
          if (Array.isArray(updated)) {
            latest = updated;
          }
        } catch (e) {
          console.error("Failed to import preset to backend:", e);
        }
      }
    }

    if (Array.isArray(latest)) {
      presets.value = latest;
    } else {
      presets.value = [...presets.value, ...normalizedPresets];
    }
    ensureManualPresetId();
    if (shell) {
      shell.activeTab.value = "presets";
    }
  };

  const importPresetsBundleFromFile = async () => {
    if (!hasTauri()) return;
    try {
      const selection = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "FFUI Presets", extensions: ["json"] }],
      });
      const path = typeof selection === "string" ? selection : "";
      if (!path) return;

      const bundle = await readPresetsBundle(path);
      await importPresetsCore(bundle?.presets);
    } catch (e) {
      console.error("Failed to import presets bundle:", e);
    }
  };

  const importPresetsBundleFromClipboard = async () => {
    if (!hasTauri()) return;
    try {
      const text = await readFromClipboard();
      if (!text || text.trim().length === 0) return;
      const parsed = await parseJsonAsync<unknown>(text);
      await importPresetsCore(isRecord(parsed) ? parsed.presets : null);
    } catch (e) {
      console.error("Failed to import presets bundle from clipboard:", e);
    }
  };

  const importPresetsCandidates = async (presetsToImport: FFmpegPreset[]) => {
    await importPresetsCore(presetsToImport);
  };

  const exportSelectedPresetsBundleToFile = async (presetIds: string[]) => {
    if (!hasTauri()) return;
    const normalizedIds = (presetIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    if (normalizedIds.length === 0) return;

    try {
      const selection = await saveDialog({
        defaultPath: "ffui-presets.json",
        filters: [{ name: "FFUI Presets", extensions: ["json"] }],
      });
      const path = typeof selection === "string" ? selection.trim() : "";
      if (!path) return;
      await exportPresetsBundle(path, normalizedIds);
    } catch (e) {
      console.error("Failed to export presets bundle:", e);
    }
  };

  const exportSelectedPresetsBundleToClipboard = async (presetIds: string[]) => {
    const normalizedIds = (presetIds ?? []).filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    if (normalizedIds.length === 0) return;

    const selected = new Set(normalizedIds);
    const presetsToExport = presets.value
      .filter((preset) => selected.has(preset.id))
      .map((preset) => ({
        ...preset,
        stats: makeZeroStats(),
      }));
    if (presetsToExport.length === 0) return;

    try {
      const bundle = {
        schemaVersion: 1,
        appVersion: await getAppVersionBestEffort(),
        exportedAtMs: Date.now(),
        presets: presetsToExport,
      };
      const serialized = await stringifyJsonAsync(bundle, 2);
      await copyToClipboard(serialized);
    } catch (e) {
      console.error("Failed to export presets bundle to clipboard:", e);
    }
  };

  const exportSelectedPresetsTemplateCommandsToClipboard = async (presetIdsInDisplayOrder: string[]) => {
    const normalizedIds = (presetIdsInDisplayOrder ?? []).filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    if (normalizedIds.length === 0) return;

    const byId = new Map(presets.value.map((preset) => [preset.id, preset] as const));
    const selectedPresets = normalizedIds
      .map((id) => byId.get(id))
      .filter((preset): preset is FFmpegPreset => Boolean(preset));
    if (selectedPresets.length === 0) return;

    const lines = selectedPresets.map((preset) => {
      // Structured presets: reuse the deterministic preview shown in the UI.
      if (!preset.advancedEnabled || !preset.ffmpegTemplate?.trim()) {
        return getPresetCommandPreview(preset);
      }

      // Advanced/template presets: normalize program token, ensure placeholders,
      // and always export with a leading `ffmpeg` program token.
      const template = preset.ffmpegTemplate.trim();
      const normalized = normalizeFfmpegTemplate(template).template.trim();
      if (normalized.toLowerCase().startsWith("ffmpeg ")) {
        return normalized;
      }
      return `ffmpeg ${normalized}`;
    });

    await copyToClipboard(lines.join("\n"));
  };

  const exportPresetToFile = async (preset: FFmpegPreset) => {
    if (!hasTauri()) return;
    if (!preset?.id) return;
    try {
      const safeName = toSafeFilenameSegment(preset.name);
      const selection = await saveDialog({
        defaultPath: `ffui-preset-${safeName}.json`,
        filters: [{ name: "FFUI Presets", extensions: ["json"] }],
      });
      const path = typeof selection === "string" ? selection.trim() : "";
      if (!path) return;
      await exportPresetsBundle(path, [preset.id]);
    } catch (e) {
      console.error("Failed to export preset to file:", e);
    }
  };

  return {
    presetsPendingBatchDelete,
    requestBatchDeletePresets,
    confirmBatchDeletePresets,
    cancelBatchDeletePresets,
    duplicatePreset,
    importPresetsBundleFromFile,
    importPresetsBundleFromClipboard,
    importPresetsCandidates,
    exportSelectedPresetsBundleToFile,
    exportSelectedPresetsBundleToClipboard,
    exportSelectedPresetsTemplateCommandsToClipboard,
    exportPresetToFile,
  };
}
