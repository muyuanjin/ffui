// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import type { FFmpegPreset } from "@/types";

const loadPresets = vi.fn();
const savePresetOnBackend = vi.fn();
const deletePresetOnBackend = vi.fn();
const reorderPresetsOnBackend = vi.fn();
const enqueueTranscodeJob = vi.fn();
const enqueueTranscodeJobs = vi.fn();
const expandManualJobInputs = vi.fn();
const readPresetsBundle = vi.fn();
const exportPresetsBundle = vi.fn();

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    loadPresets: (...args: any[]) => loadPresets(...args),
    savePresetOnBackend: (...args: any[]) => savePresetOnBackend(...args),
    deletePresetOnBackend: (...args: any[]) => deletePresetOnBackend(...args),
    reorderPresetsOnBackend: (...args: any[]) => reorderPresetsOnBackend(...args),
    enqueueTranscodeJob: (...args: any[]) => enqueueTranscodeJob(...args),
    enqueueTranscodeJobs: (...args: any[]) => enqueueTranscodeJobs(...args),
    expandManualJobInputs: (...args: any[]) => expandManualJobInputs(...args),
    readPresetsBundle: (...args: any[]) => readPresetsBundle(...args),
    exportPresetsBundle: (...args: any[]) => exportPresetsBundle(...args),
  };
});

const openDialog = vi.fn();
const saveDialog = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: (...args: any[]) => openDialog(...args),
    save: (...args: any[]) => saveDialog(...args),
  };
});

const copyToClipboard = vi.fn();

vi.mock("@/lib/copyToClipboard", () => {
  return {
    copyToClipboard: (...args: any[]) => copyToClipboard(...args),
  };
});

vi.mock("@tauri-apps/api/app", () => {
  return {
    getVersion: async () => "0.2.1",
  };
});

import { useMainAppPresets } from "./useMainAppPresets";

const makePreset = (overrides: Partial<FFmpegPreset> = {}): FFmpegPreset => ({
  id: overrides.id ?? "p1",
  name: overrides.name ?? "Preset A",
  description: overrides.description ?? "desc",
  video: overrides.video ?? { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: overrides.audio ?? { codec: "copy" },
  filters: overrides.filters ?? {},
  stats: overrides.stats ?? {
    usageCount: 5,
    totalInputSizeMB: 100,
    totalOutputSizeMB: 50,
    totalTimeSeconds: 10,
  },
});

const mountComposable = (options: Parameters<typeof useMainAppPresets>[0]) => {
  const wrapper = mount({
    setup() {
      const composable = useMainAppPresets(options);
      return { composable };
    },
    template: "<div />",
  });

  const { composable } = wrapper.vm as unknown as {
    composable: ReturnType<typeof useMainAppPresets>;
  };

  return { wrapper, composable };
};

describe("useMainAppPresets library actions", () => {
  beforeEach(() => {
    loadPresets.mockReset();
    savePresetOnBackend.mockReset();
    deletePresetOnBackend.mockReset();
    reorderPresetsOnBackend.mockReset();
    enqueueTranscodeJob.mockReset();
    enqueueTranscodeJobs.mockReset();
    expandManualJobInputs.mockReset();
    readPresetsBundle.mockReset();
    exportPresetsBundle.mockReset();
    openDialog.mockReset();
    saveDialog.mockReset();
    copyToClipboard.mockReset();
  });

  it("duplicatePreset generates a new id, auto-renames, preserves stats, and persists to backend", async () => {
    const original = makePreset({ id: "p1", name: "Preset A" });
    const presets = ref<FFmpegPreset[]>([original]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    savePresetOnBackend.mockImplementation(async (preset: FFmpegPreset) => [original, preset]);

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await composable.duplicatePreset(original);

    expect(savePresetOnBackend).toHaveBeenCalledTimes(1);
    const saved = savePresetOnBackend.mock.calls[0][0] as FFmpegPreset;
    expect(saved.id).not.toBe("p1");
    expect(saved.name).toBe("Preset A (Copy)");
    expect(saved.stats).toEqual(original.stats);
    expect(presets.value).toHaveLength(2);
    wrapper.unmount();
  });

  it("handleSavePreset keeps stats on rename but resets on transcode config change", async () => {
    const original = makePreset({ id: "p1", name: "Preset A" });
    const presets = ref<FFmpegPreset[]>([original]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    savePresetOnBackend.mockResolvedValue([original]);

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await composable.handleSavePreset({
      ...original,
      name: "Preset A (Renamed)",
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
    });

    const savedRename = savePresetOnBackend.mock.calls[0][0] as FFmpegPreset;
    expect(savedRename.stats).toEqual(original.stats);

    await composable.handleSavePreset({
      ...original,
      video: { ...original.video, qualityValue: 24 },
    });

    const savedChanged = savePresetOnBackend.mock.calls[1][0] as FFmpegPreset;
    expect(savedChanged.stats).toEqual({
      usageCount: 0,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
      totalFrames: 0,
      vmafCount: 0,
      vmafSum: 0,
      vmafMin: 0,
      vmafMax: 0,
    });

    wrapper.unmount();
  });

  it("importPresetsBundleFromFile regenerates ids, de-dupes names, zeros stats, and persists", async () => {
    const existing = makePreset({ id: "p1", name: "Preset A" });
    const presets = ref<FFmpegPreset[]>([existing]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    openDialog.mockResolvedValueOnce("/tmp/in.json");
    readPresetsBundle.mockResolvedValueOnce({
      schemaVersion: 1,
      appVersion: "0.2.1",
      exportedAtMs: 1,
      presets: [makePreset({ id: "import-1", name: "Preset A" }), makePreset({ id: "import-2", name: "Preset B" })],
    });

    savePresetOnBackend.mockImplementation(async (preset: FFmpegPreset) => [...presets.value, preset]);

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await composable.importPresetsBundleFromFile();

    expect(readPresetsBundle).toHaveBeenCalledTimes(1);
    expect(savePresetOnBackend).toHaveBeenCalledTimes(2);
    const imported1 = savePresetOnBackend.mock.calls[0][0] as FFmpegPreset;
    const imported2 = savePresetOnBackend.mock.calls[1][0] as FFmpegPreset;
    expect(imported1.id).not.toBe("import-1");
    expect(imported2.id).not.toBe("import-2");
    expect(imported1.id).not.toBe(imported2.id);
    expect(imported1.name).toBe("Preset A (Copy)");
    expect(imported2.name).toBe("Preset B");
    expect(imported1.stats.usageCount).toBe(0);
    expect(imported2.stats.usageCount).toBe(0);
    wrapper.unmount();
  });

  it("importPresetsBundleFromClipboard parses JSON, normalizes, and persists", async () => {
    const existing = makePreset({ id: "p1", name: "Preset A" });
    const presets = ref<FFmpegPreset[]>([existing]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    const bundle = {
      schemaVersion: 1,
      appVersion: "0.2.1",
      exportedAtMs: 1,
      presets: [makePreset({ id: "import-1", name: "Preset A" }), makePreset({ id: "import-2", name: "Preset B" })],
    };

    const w = globalThis as any;
    w.navigator = w.navigator ?? {};
    const originalClipboard = w.navigator.clipboard;
    const readText = vi.fn().mockResolvedValue(JSON.stringify(bundle));
    w.navigator.clipboard = { readText };

    let backendState = [...presets.value];
    savePresetOnBackend.mockImplementation(async (preset: FFmpegPreset) => {
      backendState = [...backendState, preset];
      return backendState;
    });

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    try {
      await composable.importPresetsBundleFromClipboard();
    } finally {
      w.navigator.clipboard = originalClipboard;
    }

    expect(readText).toHaveBeenCalledTimes(1);
    expect(savePresetOnBackend).toHaveBeenCalledTimes(2);
    const imported1 = savePresetOnBackend.mock.calls[0][0] as FFmpegPreset;
    const imported2 = savePresetOnBackend.mock.calls[1][0] as FFmpegPreset;
    expect(imported1.id).not.toBe("import-1");
    expect(imported2.id).not.toBe("import-2");
    expect(imported1.id).not.toBe(imported2.id);
    expect(imported1.name).toBe("Preset A (Copy)");
    expect(imported2.name).toBe("Preset B");
    expect(imported1.stats.usageCount).toBe(0);
    expect(imported2.stats.usageCount).toBe(0);

    wrapper.unmount();
  });

  it("exportSelectedPresetsBundleToFile uses a save dialog and calls exportPresetsBundle", async () => {
    const presets = ref<FFmpegPreset[]>([makePreset({ id: "p1" })]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    saveDialog.mockResolvedValueOnce(" /tmp/out.json ");
    exportPresetsBundle.mockResolvedValueOnce({ path: "/tmp/out.json" });

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await composable.exportSelectedPresetsBundleToFile(["p1"]);

    expect(exportPresetsBundle).toHaveBeenCalledTimes(1);
    expect(exportPresetsBundle).toHaveBeenCalledWith("/tmp/out.json", ["p1"]);
    wrapper.unmount();
  });

  it("exportSelectedPresetsBundleToClipboard writes a preset bundle JSON with zeroed stats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const presets = ref<FFmpegPreset[]>([
      makePreset({ id: "p1", name: "Preset A" }),
      makePreset({ id: "p2", name: "Preset B" }),
    ]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await composable.exportSelectedPresetsBundleToClipboard(["p2"]);

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    const exportedText = copyToClipboard.mock.calls[0][0] as string;
    const parsed = JSON.parse(exportedText) as any;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.appVersion).toBe("0.2.1");
    expect(parsed.exportedAtMs).toBe(new Date("2026-01-01T00:00:00Z").getTime());
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].id).toBe("p2");
    expect(parsed.presets[0].stats.usageCount).toBe(0);

    vi.useRealTimers();
    wrapper.unmount();
  });

  it("exportSelectedPresetsTemplateCommandsToClipboard copies one ffmpeg template command per preset in provided order", async () => {
    const presets = ref<FFmpegPreset[]>([
      {
        id: "p1",
        name: "Structured",
        description: "desc",
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
        audio: { codec: "copy" },
        filters: {},
        stats: {
          usageCount: 0,
          totalInputSizeMB: 0,
          totalOutputSizeMB: 0,
          totalTimeSeconds: 0,
        },
      },
      {
        id: "p2",
        name: "Advanced",
        description: "desc",
        video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
        audio: { codec: "copy" },
        filters: {},
        stats: {
          usageCount: 0,
          totalInputSizeMB: 0,
          totalOutputSizeMB: 0,
          totalTimeSeconds: 0,
        },
        advancedEnabled: true,
        ffmpegTemplate: "-i INPUT -map 0 -c:v libx264 -crf 23 -preset medium -c:a copy OUTPUT",
      },
    ]);
    const presetsLoadedFromBackend = ref(true);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    const { composable, wrapper } = mountComposable({
      t: (key: string) => key,
      locale,
      presets,
      presetsLoadedFromBackend,
      manualJobPresetId,
      dialogManager: {
        openParameterPanel: () => {},
        closeParameterPanel: () => {},
        closeWizard: () => {},
      } as any,
      shell: undefined,
    });

    await composable.exportSelectedPresetsTemplateCommandsToClipboard(["p2", "p1"]);

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    const copied = copyToClipboard.mock.calls[0][0] as string;
    const lines = copied.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("ffmpeg -i INPUT")).toBe(true);
    expect(lines[1].startsWith("ffmpeg -progress pipe:2")).toBe(true);

    wrapper.unmount();
  });
});
