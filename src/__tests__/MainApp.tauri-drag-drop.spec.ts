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

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  const enqueueTranscodeJob = vi.fn(async () => ({} as any));
  const expandManualJobInputs = vi.fn(async (paths: string[]) => paths);

  return {
    ...actual,
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => "{}"),
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
    expandManualJobInputs,
    enqueueTranscodeJob,
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(
      async (candidates: string[]) => candidates[0] ?? null,
    ),
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

    const droppedPath = "C:/videos/sample.mp4";
    dragDropHandler?.({
      payload: {
        paths: [droppedPath],
      },
    });
    await nextTick();

    // Ensure the backend enqueue call was triggered with the dropped path.
    expect(enqueueTranscodeJob).toHaveBeenCalledTimes(1);
    const [args] = (enqueueTranscodeJob as any).mock.calls[0];
    expect(args).toMatchObject({
      // In Tauri mode we now pass the full path through so the backend can
      // compute metadata and build output paths correctly.
      filename: droppedPath,
      source: "manual",
      jobType: "video",
    });

    wrapper.unmount();
    expect(unlistenCalled).toBe(true);
  });
});
