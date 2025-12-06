// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

let dragDropHandler: ((event: { payload: { paths: string[] } }) => void) | null =
  null;
let unlistenCalled = false;

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

vi.mock("@/lib/backend", () => {
  const enqueueTranscodeJob = vi.fn(async () => ({} as any));

  return {
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob,
    cancelTranscodeJob: vi.fn(async () => true),
  };
});

import MainApp from "@/MainApp.vue";
import { enqueueTranscodeJob } from "@/lib/backend";
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

describe("MainApp Tauri drag & drop integration", () => {
  beforeEach(() => {
    dragDropHandler = null;
    unlistenCalled = false;
    listenMock.mockReset();
    (enqueueTranscodeJob as any).mockClear?.();
    // Ensure hasTauri() sees a Tauri-like environment.
    (window as any).__TAURI__ = {};

    listenMock.mockImplementation(
      async (
        event: string,
        handler: (event: { payload: { paths: string[] } }) => void,
      ) => {
        if (event === "tauri://drag-drop") {
          dragDropHandler = handler;
        }
        return () => {
          unlistenCalled = true;
        };
      },
    );
  });

  it("subscribes to tauri://drag-drop and enqueues manual jobs on the queue tab", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    await nextTick();
    expect(listenMock).toHaveBeenCalled();
    expect(typeof dragDropHandler).toBe("function");

    // Ensure we are on the queue tab so dropped files are enqueued.
    vm.activeTab = "queue";
    await nextTick();

    dragDropHandler?.({
      payload: {
        paths: ["C:/videos/sample.mp4"],
      },
    });
    await nextTick();

    // Ensure the backend enqueue call was triggered with the dropped path.
    expect(enqueueTranscodeJob).toHaveBeenCalledTimes(1);
    const [args] = (enqueueTranscodeJob as any).mock.calls[0];
    expect(args).toMatchObject({
      filename: "sample.mp4",
      source: "manual",
      jobType: "video",
    });

    wrapper.unmount();
    expect(unlistenCalled).toBe(true);
  });
});
