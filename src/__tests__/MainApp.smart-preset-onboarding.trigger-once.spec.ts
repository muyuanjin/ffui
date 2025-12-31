// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { AppSettings } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";
import { i18n, invokeMock, useBackendMock } from "./helpers/mainAppTauriDialog";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import MainApp from "@/MainApp.vue";

const flushTimers = () => new Promise((resolve) => setTimeout(resolve, 0));

const baseSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
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
  taskbarProgressMode: "byEstimatedTime",
  queuePersistenceMode: "none",
  ...overrides,
});

describe("MainApp smart preset onboarding auto-trigger", () => {
  it("opens once when onboardingCompleted=false, and does not re-open on later AppSettings updates", async () => {
    let resolveSettings!: (value: AppSettings) => void;
    const settingsPromise = new Promise<AppSettings>((resolve) => {
      resolveSettings = resolve;
    });

    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_presets: () => [],
      get_app_settings: () => settingsPromise,
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      get_external_tool_statuses_cached: () => [],
      save_app_settings: ({ settings } = {}) => settings,
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);
    const dialogManager = vm.dialogManager ?? vm.dialogs?.dialogManager;

    expect(dialogManager?.smartPresetImportOpen?.value).toBe(false);

    resolveSettings(baseSettings({ onboardingCompleted: false }));
    await flushTimers();
    await nextTick();

    expect(dialogManager.smartPresetImportOpen.value).toBe(true);

    const saveCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_app_settings");
    expect(saveCalls.some(([, payload]) => (payload as any)?.settings?.onboardingCompleted === true)).toBe(true);

    dialogManager.closeSmartPresetImport();
    await nextTick();
    expect(dialogManager.smartPresetImportOpen.value).toBe(false);

    // Simulate a later AppSettings snapshot replacing the object reference.
    vm.settings.appSettings.value = {
      ...vm.settings.appSettings.value,
      selectionBarPinned: true,
    };
    await nextTick();
    await flushTimers();
    await nextTick();

    expect(dialogManager.smartPresetImportOpen.value).toBe(false);

    wrapper.unmount();
  });

  it("does not auto-open when onboardingCompleted=true", async () => {
    useBackendMock({
      get_queue_state: () => ({ jobs: [] }),
      get_presets: () => [],
      get_app_settings: () => baseSettings({ onboardingCompleted: true }),
      get_cpu_usage: () => ({ overall: 0, perCore: [] }),
      get_gpu_usage: () => ({ available: false }),
      get_external_tool_statuses: () => [],
      get_external_tool_statuses_cached: () => [],
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = withMainAppVmCompat(wrapper);
    const dialogManager = vm.dialogManager ?? vm.dialogs?.dialogManager;

    await flushTimers();
    await nextTick();

    expect(dialogManager?.smartPresetImportOpen?.value).toBe(false);

    wrapper.unmount();
  });
});
