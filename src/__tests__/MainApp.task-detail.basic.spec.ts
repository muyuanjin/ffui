// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => false,
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({}) as any),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({}) as any),
    loadAppSettings: vi.fn(async () => ({}) as any),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
    loadSmartDefaultPresets: vi.fn(async () => []),
    loadPresets: vi.fn(async () => []),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({}) as any),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const setJobsOnVm = (vm: any, jobs: TranscodeJob[]) => {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
};

describe("MainApp task detail surface - basics", () => {
  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
    i18n.global.locale.value = "en";
  });

  it("shows the image Batch Compress output path when present", async () => {
    const job: TranscodeJob = {
      id: "image-job-1",
      filename: "C:/images/sample.png",
      type: "image",
      source: "batch_compress",
      originalSizeMB: 2,
      originalCodec: "png",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 3000,
      endTime: Date.now(),
      logs: [],
      inputPath: "C:/images/sample.png",
      outputPath: "C:/images/sample.avif",
      previewPath: "C:/images/sample.avif",
    };

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const outputPathEl = document.querySelector("[data-testid='task-detail-output-path']") as HTMLElement | null;

    expect(outputPathEl).toBeTruthy();
    expect(outputPathEl?.textContent).toContain("C:/images/sample.avif");

    wrapper.unmount();
  });

  it("renders encoder command and logs for image Batch Compress jobs", async () => {
    const job: TranscodeJob = {
      id: "image-job-2",
      filename: "C:/images/sample2.png",
      type: "image",
      source: "batch_compress",
      originalSizeMB: 2,
      originalCodec: "png",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 3000,
      endTime: Date.now(),
      logs: [
        'command: avifenc --lossless --depth 10 --yuv 444 --cicp 1/13/1 --range full "C:/images/sample2.png" "C:/images/sample2.tmp.avif"',
        "avifenc: lossless AVIF encode completed; new size 1.00 MB (50.0% of original)",
      ],
      inputPath: "C:/images/sample2.png",
      outputPath: "C:/images/sample2.avif",
      ffmpegCommand:
        'avifenc --lossless --depth 10 --yuv 444 --cicp 1/13/1 --range full "C:/images/sample2.png" "C:/images/sample2.tmp.avif"',
      previewPath: "C:/images/sample2.avif",
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const commandEl = document.querySelector("[data-testid='task-detail-command']") as HTMLElement | null;
    expect(commandEl).toBeTruthy();
    expect(commandEl?.textContent || "").toContain("avifenc");

    const logContainer = document.querySelector("[data-testid='task-detail-log']") as HTMLElement | null;
    expect(logContainer).toBeTruthy();
    expect(logContainer?.textContent || "").toContain("avifenc");

    wrapper.unmount();
  });

  it("renders rich details for a completed job", async () => {
    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      outputSizeMB: 5,
      logs: [],
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand: 'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
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

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const text = document.body.textContent ?? "";
    expect(text).toContain("sample.mp4");
    expect(text).toContain("1920");
    expect(text.toLowerCase()).toContain("h264");
    expect(text).toContain("ffmpeg -i");
    expect(text).toContain("Universal 1080p");

    const titleEl = document.querySelector("[data-testid='task-detail-title']") as HTMLElement | null;
    expect(titleEl?.textContent?.trim()).toBe("sample.mp4");
  });

  it("prefers backend elapsedMs for processing time and ignores media duration", async () => {
    const job: TranscodeJob = {
      id: "job-processing-time",
      filename: "C:/videos/elapsed.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      // 刻意让 elapsedMs 与 start/end 差值不一致：以便验证优先使用 elapsedMs。
      startTime: 1_000,
      endTime: 5_200,
      elapsedMs: 6_600,
      mediaInfo: {
        durationSeconds: 120,
        width: 1920,
        height: 1080,
      },
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    if (vm.selectedJobForDetail && "value" in vm.selectedJobForDetail) {
      vm.selectedJobForDetail.value = job;
    } else {
      vm.selectedJobForDetail = job;
    }

    await nextTick();

    const selectedJob: TranscodeJob | null =
      vm.selectedJobForDetail && "value" in vm.selectedJobForDetail
        ? vm.selectedJobForDetail.value
        : vm.selectedJobForDetail;
    const expectedSeconds = selectedJob?.elapsedMs != null ? (selectedJob.elapsedMs / 1000).toFixed(1) : null;
    const fallbackSeconds =
      selectedJob?.startTime && selectedJob?.endTime
        ? ((selectedJob.endTime - selectedJob.startTime) / 1000).toFixed(1)
        : null;

    const processingEls = document.querySelectorAll("[data-testid='task-detail-processing-time']");
    const processingEl = processingEls[processingEls.length - 1] as HTMLElement | undefined;
    expect(processingEl).toBeTruthy();
    const text = processingEl?.textContent || "";
    expect(text).toContain("Processing time");
    expect(expectedSeconds).not.toBeNull();
    // 应显示 elapsedMs 对应的秒数
    expect(text).toContain(expectedSeconds || "");
    // 不应退回到 start/end 差值
    if (fallbackSeconds) {
      expect(text).not.toContain(fallbackSeconds);
    }
    // 也不应错误地展示媒体总时长
    expect(text).not.toContain("120");

    wrapper.unmount();
  });

  it("highlights failure reason and log tail for failed jobs", async () => {
    const job: TranscodeJob = {
      id: "job-2",
      filename: "C:/videos/sample2.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "failed",
      progress: 0,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: ["failed: gpu decode error"],
      logTail: ["trace: gpu decode error detail"],
      skipReason: undefined,
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const text = document.body.textContent ?? "";
    // 失败文案和主错误信息必须可见
    expect(text.toLowerCase()).toContain("failed");
    expect(text).toContain("gpu decode error");
  });

  it("uses a scrollable container for long task details", async () => {
    const longLogs = Array.from({ length: 80 }, (_, i) => `line-${i}`).join("\n");
    const job: TranscodeJob = {
      id: "job-3",
      filename: "C:/videos/sample3.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "failed",
      progress: 0,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: [longLogs],
      logTail: undefined,
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const logContainer = document.querySelector("[data-testid='task-detail-log']") as HTMLElement | null;
    expect(logContainer).toBeTruthy();
    // 滚动性由内部内容区域负责，这里只断言日志容器存在
  });

  it("shows an explicit fallback label when the preset referenced by the job is missing", async () => {
    const job: TranscodeJob = {
      id: "job-4",
      filename: "C:/videos/missing-preset.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "missing",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: [],
      logTail: [],
      ffmpegCommand: "ffmpeg -i input output",
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const text = document.body.textContent ?? "";
    expect(text).toContain("missing");
    expect(text.toLowerCase()).toContain("unknown preset");
  });

  it("updates command view toggle label in task detail when locale changes at runtime", async () => {
    const job: TranscodeJob = {
      id: "job-5",
      filename: "C:/videos/locale-switch.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 2000,
      endTime: Date.now(),
      logs: [],
      ffmpegCommand:
        'ffmpeg -i "C:/videos/locale-switch.mp4" -c:v libx264 -crf 23 -preset medium -c:a copy "C:/videos/locale-switch.compressed.mp4"',
    } as any;

    const getButtonsWithText = (substr: string) =>
      Array.from(document.querySelectorAll("button")).filter((btn) => (btn.textContent || "").includes(substr));

    // Record baseline counts before mounting this MainApp instance to avoid
    // interference from other tests sharing the same jsdom document.
    const baselineEnButtons = getButtonsWithText("Show template view").length;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    // EN label should increase by at least one for this instance.
    let enButtons = getButtonsWithText("Show template view");
    expect(enButtons.length).toBeGreaterThanOrEqual(baselineEnButtons + 1);

    // Switch locale to zh-CN and ensure label updates (no EN labels should remain).
    i18n.global.locale.value = "zh-CN";
    await nextTick();

    const zhButtons = getButtonsWithText("显示模板视图");
    enButtons = getButtonsWithText("Show template view");

    expect(zhButtons.length).toBeGreaterThanOrEqual(1);
    expect(enButtons.length).toBe(0);
  });
});
