import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

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

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn(),
    convertFileSrc: (path: string) => path,
  };
});

vi.mock("@/lib/backend", () => {
  const loadPreviewDataUrl = vi.fn(async () => "data:image/jpeg;base64,AAA=");

  return {
    hasTauri: () => true,
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({} as any)),
    cancelTranscodeJob: vi.fn(async () => true),
    loadPreviewDataUrl,
  };
});

import MainApp from "@/MainApp.vue";
import { loadPreviewDataUrl } from "@/lib/backend";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

describe("MainApp Tauri preview fallback", () => {
  beforeEach(() => {
    (window as any).__TAURI__ = {};
    (loadPreviewDataUrl as any).mockClear?.();
  });

  it("falls back to backend data URL when preview image fails to load", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    const job = {
      id: "job-1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      previewPath: "C:/app-data/previews/abc123.jpg",
    };

    // Seed the queue and open the detail view.
    if (Array.isArray(vm.jobs)) {
      vm.jobs = [job];
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = [job];
    }
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const spy = loadPreviewDataUrl as any;
    spy.mockResolvedValueOnce("data:image/jpeg;base64,TEST=");

    // Simulate the <img> error handler.
    vm.handlePreviewImageError();
    await nextTick();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(job.previewPath);

    // The fallback URL should drive the preview image computed value.
    expect(vm.jobDetailFallbackPreviewUrl).toBe("data:image/jpeg;base64,TEST=");
    expect(vm.jobDetailPreviewUrl).toBe("data:image/jpeg;base64,TEST=");

    wrapper.unmount();
  });
});
