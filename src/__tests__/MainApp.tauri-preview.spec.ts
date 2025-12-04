import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

const openPathMock = vi.fn();

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
    openPath: (...args: any[]) => openPathMock(...args),
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
    buildPreviewUrl: (path: string | null) => path,
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
    loadPreviewDataUrl,
  };
});

import MainApp from "@/MainApp.vue";
import { loadPreviewDataUrl, loadQueueState } from "@/lib/backend";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

const queueItemStub = {
  props: ["job", "preset", "canCancel", "viewMode", "progressStyle"],
  template:
    '<div data-testid="queue-item-stub"><button data-testid="queue-item-thumbnail" @click="$emit(\'preview\', job)"></button></div>',
};

describe("MainApp Tauri preview fallback", () => {
  beforeEach(() => {
    (window as any).__TAURI__ = {};
    (loadPreviewDataUrl as any).mockClear?.();
    (loadQueueState as any).mockClear?.();
    openPathMock.mockClear();
  });

  it("falls back to backend data URL when preview image fails to load", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
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

  it("uses an image viewer for expanded preview when the job type is image", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;

    const job = {
      id: "job-image-1",
      filename: "C:/images/sample.avif",
      type: "image",
      source: "manual",
      originalSizeMB: 2,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
      inputPath: "C:/images/sample.avif",
      previewPath: "C:/app-data/previews/img123.jpg",
    };

    // Seed the queue so that openJobPreviewFromQueue can find the job.
    if (Array.isArray(vm.jobs)) {
      vm.jobs = [job];
    } else if (vm.jobs && "value" in vm.jobs) {
      vm.jobs.value = [job];
    }

    await nextTick();

    // Open the preview directly from the queue helper.
    if (typeof vm.openJobPreviewFromQueue === "function") {
      vm.openJobPreviewFromQueue(job);
    }

    await nextTick();

    const expandedVideo = wrapper.find(
      "[data-testid='task-detail-expanded-video']",
    );

    // For image jobs we should not render a <video> element as the preview
    // surface, and the expanded preview URL should be populated.
    expect(vm.expandedPreviewUrl).toBe(job.previewPath);
    expect(vm.expandedPreviewIsImage).toBe(true);
    expect(expandedVideo.exists()).toBe(false);

    wrapper.unmount();
  });

  // NOTE: Additional Tauri preview integration tests were removed here because
  // they interacted with real <video> media loading in jsdom and caused flaky
  // CSS parser errors in the test environment (NaN widths leading to invalid
  // calc() expressions). The core contract – queue thumbnail click wires the
  // correct job into expandedPreviewUrl – is already covered in the app-level
  // Tauri dialog tests, and the EXE behaviour is verified manually.
});
