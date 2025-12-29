// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { AppSettings, FFmpegPreset } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";
import { i18n, invokeMock, useBackendMock } from "./helpers/mainAppTauriDialog";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import MainApp from "@/MainApp.vue";

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

const makePresets = (): FFmpegPreset[] => [
  {
    id: "p1",
    name: "Preset 1",
    description: "",
    video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" } as any,
    audio: { codec: "copy" } as any,
    filters: {},
    stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  },
];

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: false,
    autoUpdate: false,
    downloaded: undefined,
  },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  defaultQueuePresetId: "p1",
  presetSortMode: "manual",
  presetViewMode: "grid",
  taskbarProgressMode: "byEstimatedTime",
  queuePersistenceMode: "none",
  onboardingCompleted: true,
});

describe("MainApp preset sort mode persistence (before AppSettings load)", () => {
  it("persists user-selected presetSortMode even when selected before AppSettings finish loading", async () => {
    const presets = makePresets();
    const backendSettings = makeAppSettings();

    let resolveSettings!: (value: AppSettings) => void;
    const settingsPromise = new Promise<AppSettings>((resolve) => {
      resolveSettings = resolve;
    });

    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_presets: () => presets,
      get_app_settings: () => settingsPromise,
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      save_app_settings: ({ settings } = {}) => settings,
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);

    // Change sort mode before get_app_settings resolves.
    vm.presetSortMode = "name";
    await nextTick();

    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "save_app_settings").length).toBe(0);

    resolveSettings(backendSettings);
    await flushTimers();
    await nextTick();
    await flushTimers();
    await nextTick();

    const saveCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_app_settings");
    expect(saveCalls.length).toBe(1);
    const payload = (saveCalls[0]?.[1] ?? {}) as Record<string, any>;
    expect(payload.settings?.presetSortMode).toBe("name");

    wrapper.unmount();
  });
});
