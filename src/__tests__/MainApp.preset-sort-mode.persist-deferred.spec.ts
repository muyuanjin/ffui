// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { AppSettings, FFmpegPreset } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";
import { i18n, invokeMock, useBackendMock } from "./helpers/mainAppTauriDialog";
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

describe("MainApp preset sort mode persistence", () => {
  it("defers saving preset sort mode so UI updates are not blocked", async () => {
    let idleCallback: ((deadline: IdleDeadline) => void) | null = null;
    const originalRequestIdleCallback = (window as any).requestIdleCallback;
    const originalCancelIdleCallback = (window as any).cancelIdleCallback;
    try {
      (window as any).requestIdleCallback = (cb: (deadline: IdleDeadline) => void) => {
        idleCallback = cb;
        return 1;
      };
      (window as any).cancelIdleCallback = () => {
        idleCallback = null;
      };

      const presets = makePresets();
      const appSettings = makeAppSettings();
      useBackendMock({
        get_queue_state: () => ({ jobs: [] }),
        get_presets: () => presets,
        get_app_settings: () => appSettings,
        get_cpu_usage: () => ({ overall: 0, perCore: [] }),
        get_gpu_usage: () => ({ available: false }),
        get_external_tool_statuses: () => [],
        save_app_settings: ({ settings } = {}) => settings,
      });

      const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
      const vm: any = wrapper.vm;

      await nextTick();
      await flushTimers();
      await nextTick();
      invokeMock.mockClear();

      vm.activeTab = "presets";
      await nextTick();

      vm.presetSortMode = "name";
      await nextTick();

      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "save_app_settings").length).toBe(0);

      const cb = idleCallback as unknown;
      if (typeof cb === "function") {
        (cb as any)({ didTimeout: false, timeRemaining: () => 50 });
      }
      await flushTimers();
      await nextTick();

      const saveCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_app_settings");
      expect(saveCalls.length).toBe(1);
      const payload = (saveCalls[0]?.[1] ?? {}) as Record<string, any>;
      expect(payload.settings?.presetSortMode).toBe("name");

      wrapper.unmount();
    } finally {
      (window as any).requestIdleCallback = originalRequestIdleCallback;
      (window as any).cancelIdleCallback = originalCancelIdleCallback;
    }
  });
});
