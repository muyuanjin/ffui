// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

let dragDropHandler: ((event: { payload: { paths: string[] } }) => void) | null = null;

const listenMock = vi.fn<
  (
    event: string,
    handler: (event: { payload: { paths: string[] } }) => void,
  ) => Promise<() => void>
>();

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
  };
});

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      show: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }),
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  const inspectMedia = vi.fn(
    async () => '{"format":{"duration":"60"},"streams":[],"file":{"path":"C:/videos/sample.mp4"}}',
  );

  return {
    ...actual,
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia,
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
    loadSmartDefaultPresets: vi.fn(async () => []),
    loadPresets: vi.fn(async () => []),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({} as any)),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(
      async (candidates: string[]) => candidates[0] ?? null,
    ),
  };
});

import MainApp from "@/MainApp.vue";
import { inspectMedia } from "@/lib/backend";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainApp media inspect in Tauri mode", () => {
  beforeEach(() => {
    dragDropHandler = null;
    listenMock.mockReset();
    (inspectMedia as any).mockClear?.();
    (window as any).__TAURI__ = {};

    listenMock.mockImplementation(
      async (event: string, handler: (event: { payload: { paths: string[] } }) => void) => {
        if (event === "tauri://drag-drop") {
          dragDropHandler = handler;
        }
        return () => {};
      },
    );
  });

  it("uses tauri://drag-drop to inspect media when dropping files on the media tab", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    await nextTick();
    expect(listenMock).toHaveBeenCalled();
    expect(typeof dragDropHandler).toBe("function");

    // Switch to media tab.
    vm.activeTab = "media";
    await nextTick();

    dragDropHandler?.({
      payload: {
        paths: ["C:/videos/sample.mp4"],
      },
    });
    await nextTick();
    await Promise.resolve();

    expect(inspectMedia).toHaveBeenCalledTimes(1);
    expect((inspectMedia as any).mock.calls[0][0]).toBe("C:/videos/sample.mp4");

    expect(vm.inspectedMediaPath).toBe("C:/videos/sample.mp4");
    expect(vm.inspectedAnalysis && vm.inspectedAnalysis.summary).not.toBeNull();

    wrapper.unmount();
  });
});
