import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

let dragDropHandler: ((event: any) => void) | null = null;
let unlistenCalled = false;

const onDragDropEventMock = vi.fn(async (handler: (event: any) => void) => {
  dragDropHandler = handler;
  return () => {
    unlistenCalled = true;
  };
});

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      onDragDropEvent: onDragDropEventMock,
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

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

describe("MainApp Tauri drag & drop integration", () => {
  beforeEach(() => {
    dragDropHandler = null;
    unlistenCalled = false;
    onDragDropEventMock.mockClear();
    (enqueueTranscodeJob as any).mockClear?.();
    // Ensure hasTauri() sees a Tauri-like environment.
    (window as any).__TAURI__ = {};
  });

  it("uses onDragDropEvent to drive drag overlay and enqueue manual jobs on the queue tab", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    await nextTick();
    expect(onDragDropEventMock).toHaveBeenCalledTimes(1);
    expect(typeof dragDropHandler).toBe("function");

    // Simulate the user dragging a media file into the window.
    dragDropHandler?.({
      event: "tauri://drag-enter",
      id: 1,
      payload: {
        type: "enter",
        paths: ["C:/videos/sample.mp4"],
        position: { x: 0, y: 0 },
      },
    });
    await nextTick();
    expect(vm.isDragging).toBe(true);

    // Simulate dropping the file to create a manual job in the queue.
    dragDropHandler?.({
      event: "tauri://drag-drop",
      id: 2,
      payload: {
        type: "drop",
        paths: ["C:/videos/sample.mp4"],
        position: { x: 10, y: 20 },
      },
    });
    await nextTick();

    expect(vm.isDragging).toBe(false);
    expect(vm.lastDroppedRoot).toBe("C:/videos");
    expect(vm.showSmartScan).toBe(false);

    // Ensure the backend enqueue call was triggered with the dropped path.
    expect(enqueueTranscodeJob).toHaveBeenCalledTimes(1);
    const [args] = (enqueueTranscodeJob as any).mock.calls[0];
    expect(args).toMatchObject({
      filename: "C:/videos/sample.mp4",
      source: "manual",
      jobType: "video",
    });

    wrapper.unmount();
    expect(unlistenCalled).toBe(true);
  });
});
