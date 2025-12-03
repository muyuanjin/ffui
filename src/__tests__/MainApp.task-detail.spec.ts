import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      show: vi.fn(),
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      onDragDropEvent: vi.fn(async () => () => {}),
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn().mockResolvedValue(() => {}),
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
  return {
    hasTauri: () => false,
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({} as any)),
    cancelTranscodeJob: vi.fn(async () => true),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

const setJobsOnVm = (vm: any, jobs: TranscodeJob[]) => {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
};

describe("MainApp task detail surface", () => {
  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
  });

  it("renders rich details for a completed job", async () => {
    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      outputSizeMB: 5,
      logs: [],
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
      mediaInfo: {
        durationSeconds: 120,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        videoCodec: "h264",
        sizeMB: 10,
      },
      previewPath: "C:/app-data/previews/abc123.jpg",
    };

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    // Expose the job to the detail surface directly.
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const text = document.body.textContent ?? "";
    expect(text).toContain("sample.mp4");
    // Media metadata summary.
    expect(text).toContain("1920");
    expect(text.toLowerCase()).toContain("h264");
    // Command snippet should appear.
    expect(text).toContain("ffmpeg -i");

    // Title should use the file name, not the full path.
    const titleEl = document.querySelector(
      "[data-testid='task-detail-title']",
    ) as HTMLElement | null;
    expect(titleEl?.textContent?.trim()).toBe("sample.mp4");

    // Paths should remain copyable and selectable.
    const inputPathEl = document.querySelector(
      "[data-testid='task-detail-input-path']",
    ) as HTMLElement | null;
    expect(inputPathEl?.textContent).toContain("C:/videos/sample.mp4");
    expect(inputPathEl?.className).toContain("select-text");

    const outputPathEl = document.querySelector(
      "[data-testid='task-detail-output-path']",
    ) as HTMLElement | null;
    expect(outputPathEl?.textContent).toContain("C:/videos/sample.compressed.mp4");
    expect(outputPathEl?.className).toContain("select-text");
  });

  it("highlights failure reason and log tail for failed jobs", async () => {
    const job: TranscodeJob = {
      id: "job-2",
      filename: "C:/videos/error.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "failed",
      progress: 100,
      startTime: Date.now() - 3000,
      endTime: Date.now(),
      logs: ["command: ffmpeg ...", "ffmpeg exited with non-zero status (exit code 1)"],
      logTail: "ffmpeg exited with non-zero status (exit code 1)",
      failureReason: "ffmpeg exited with non-zero status (exit code 1)",
    };

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).toContain("ffmpeg exited with non-zero status".toLowerCase());
  });

  it("uses a scrollable container for long task details", async () => {
    const job: TranscodeJob = {
      id: "job-3",
      filename: "C:/videos/long-output.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 10000,
      endTime: Date.now(),
      outputSizeMB: 5,
      logs: new Array(200).fill("some ffmpeg output line"),
      logTail: "some ffmpeg output line",
    };

    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const html = document.body.innerHTML;
    expect(html).toContain('flex-1 bg-muted/30 px-6 py-4 text-xs');
  });
});
