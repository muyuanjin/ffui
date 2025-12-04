import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

let dragDropHandler: ((event: any) => void) | null = null;

const onDragDropEventMock = vi.fn(async (handler: (event: any) => void) => {
  dragDropHandler = handler;
  return () => {};
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
  const inspectMedia = vi.fn(async () => '{"format":{"duration":"60"},"streams":[]}');

  return {
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia,
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    loadPresets: vi.fn(async () => []),
    enqueueTranscodeJob: vi.fn(async () => ({} as any)),
    cancelTranscodeJob: vi.fn(async () => true),
  };
});

import MainApp from "@/MainApp.vue";
import { inspectMedia } from "@/lib/backend";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

describe("MainApp media inspect in Tauri mode", () => {
  beforeEach(() => {
    dragDropHandler = null;
    onDragDropEventMock.mockClear();
    (inspectMedia as any).mockClear?.();
    (window as any).__TAURI__ = {};
  });

  it("uses onDragDropEvent to inspect media when dropping files on the media tab", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    await nextTick();
    expect(onDragDropEventMock).toHaveBeenCalledTimes(1);
    expect(typeof dragDropHandler).toBe("function");

    // Switch to media tab.
    vm.activeTab = "media";
    await nextTick();

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
    expect(inspectMedia).toHaveBeenCalledTimes(1);
    expect((inspectMedia as any).mock.calls[0][0]).toBe("C:/videos/sample.mp4");

    const source = vm.mediaInspectSource;
    expect(source && "name" in source ? source.name : "").toContain("sample.mp4");
  });
});

