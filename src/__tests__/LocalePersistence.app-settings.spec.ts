// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import MainApp from "@/MainApp.vue";
import TitleBar from "@/components/TitleBar.vue";
import type { AppSettings } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      onDragDropEvent: vi.fn(async () => () => {}),
      show: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => () => {}),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: vi.fn(),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => {
  return {
    openPath: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn(),
    convertFileSrc: (path: string) => path,
  };
});

const saveAppSettingsMock = vi.fn(async (settings: AppSettings) => settings);
const loadAppSettingsMock = vi.fn();

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
    loadAppSettings: (...args: any[]) => loadAppSettingsMock(...args),
    saveAppSettings: (settings: AppSettings) => saveAppSettingsMock(settings),
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision ? `${path}?ffuiPreviewRev=${revision}` : path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({ overall: 0, perCore: [] })),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({ available: false })),
    loadPresets: vi.fn(async () => []),
    loadSmartDefaultPresets: vi.fn(async () => []),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
    loadPreviewDataUrl: vi.fn(async () => ""),
    runAutoCompress: vi.fn(async () => ({
      rootPath: "",
      jobs: [],
      totalFilesScanned: 0,
      totalCandidates: 0,
      totalProcessed: 0,
      batchId: "test-batch",
      startedAtMs: Date.now(),
      completedAtMs: Date.now(),
    })),
    savePresetOnBackend: vi.fn(async (preset: any) => [preset]),
    deletePresetOnBackend: vi.fn(async () => []),
    enqueueTranscodeJob: vi.fn(async () => ({}) as any),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

const makeAppSettings = (locale?: string): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: false,
    autoUpdate: false,
  },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  taskbarProgressMode: "byEstimatedTime",
  locale,
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Locale persistence via AppSettings", () => {
  beforeEach(() => {
    (window as any).__TAURI__ = {};
    saveAppSettingsMock.mockClear();
    loadAppSettingsMock.mockReset();
  });

  it("restores i18n locale from AppSettings on startup", async () => {
    loadAppSettingsMock.mockResolvedValueOnce(makeAppSettings("zh-CN"));

    const i18n = createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: en as any,
        "zh-CN": zhCN as any,
      },
    });

    mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    await nextTick();

    expect(i18n.global.locale.value).toBe("zh-CN");
  });

  it("persists locale changes into AppSettings saves", async () => {
    loadAppSettingsMock.mockResolvedValueOnce(makeAppSettings("zh-CN"));

    const i18n = createI18n({
      legacy: false,
      locale: "zh-CN",
      messages: {
        en: en as any,
        "zh-CN": zhCN as any,
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await flushPromises();
    saveAppSettingsMock.mockClear();

    // Seed settings so the locale-change handler can update and persist.
    vm.appSettings = makeAppSettings("zh-CN");
    await nextTick();

    wrapper.findComponent(TitleBar).vm.$emit("localeChange", "en");
    await nextTick();
    await flushPromises();

    expect(saveAppSettingsMock).toHaveBeenCalled();
    const lastCallArgs = saveAppSettingsMock.mock.calls[saveAppSettingsMock.mock.calls.length - 1]?.[0] as
      | AppSettings
      | undefined;
    expect(lastCallArgs?.locale).toBe("en");
  });
});
