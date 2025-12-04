import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";
import { normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";

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
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => "{}"),
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
      presetId: "p1",
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

    // Preset name from the active preset list should be visible.
    expect(text).toContain("Universal 1080p");

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

    // Header should render with a blurred background when preview is present.
    const headerEl = document.querySelector(
      "[data-testid='task-detail-header']",
    ) as HTMLElement | null;
    expect(headerEl).not.toBeNull();

    const headerBgEl = document.querySelector(
      "[data-testid='task-detail-header-bg']",
    ) as HTMLElement | null;
    expect(headerBgEl).not.toBeNull();

    // Clicking the preview area should open an expanded preview surface even
    // in non-Tauri (test) mode, falling back to a text-only message.
    const previewButton = document.querySelector(
      "[data-testid='task-detail-preview']",
    ) as HTMLElement | null;
    expect(previewButton).not.toBeNull();
    previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    const expandedFallback = document.querySelector(
      "[data-testid='task-detail-expanded-fallback']",
    ) as HTMLElement | null;
    expect(expandedFallback).not.toBeNull();

    const expandedVideo = document.querySelector(
      "[data-testid='task-detail-expanded-video']",
    ) as HTMLVideoElement | null;
    expect(expandedVideo).toBeNull();
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

  it("shows an explicit fallback label when the preset referenced by the job is missing", async () => {
    const job: TranscodeJob = {
      id: "job-missing-preset",
      filename: "C:/videos/missing-preset.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "missing-preset",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 2000,
      endTime: Date.now(),
      outputSizeMB: 5,
      logs: [],
      inputPath: "C:/videos/missing-preset.mp4",
      outputPath: "C:/videos/missing-preset.compressed.mp4",
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
    expect(text).toContain("Unknown preset (missing-preset)");
  });

  it("highlights command and logs while preserving exact text and copy semantics", async () => {
    const logLines = [
      "ffmpeg version n6.1.1 Copyright (c) 2000-2024 the FFmpeg developers",
      "  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080",
      "frame=  10 fps=0.0 q=-1.0 size=       0kB time=00:00:00.33 bitrate=   0.0kbits/s speed=0.66x",
      "ffmpeg exited with non-zero status (exit code 1)",
    ];
    const job: TranscodeJob = {
      id: "job-4",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "failed",
      progress: 100,
      startTime: Date.now() - 4000,
      endTime: Date.now(),
      outputSizeMB: 5,
      logs: logLines,
      logTail: logLines.join("\n"),
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
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

    const commandEls = document.querySelectorAll<HTMLElement>(
      "[data-testid='task-detail-command']",
    );
    const commandEl = commandEls[commandEls.length - 1] ?? null;
    expect(commandEl).not.toBeNull();
    const expectedTemplate = normalizeFfmpegTemplate(
      job.ffmpegCommand as string,
    ).template;
    expect(commandEl?.textContent).toBe(expectedTemplate);

    const logsEls = document.querySelectorAll<HTMLElement>(
      "[data-testid='task-detail-logs']",
    );
    const logsEl = logsEls[logsEls.length - 1] ?? null;
    expect(logsEl).not.toBeNull();
    const logsText = logsEl?.textContent ?? "";
    expect(logsText).toContain(
      "ffmpeg exited with non-zero status (exit code 1)",
    );

    const logsHtml = logsEl?.innerHTML ?? "";
    expect(logsHtml.toLowerCase()).toContain("text-destructive");

    const originalClipboard = (navigator as any).clipboard;
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: writeTextMock };

    const copyCommandButtons = document.querySelectorAll<HTMLButtonElement>(
      "[data-testid='task-detail-copy-command']",
    );
    const copyCommandButton =
      copyCommandButtons[copyCommandButtons.length - 1] ?? null;
    expect(copyCommandButton).not.toBeNull();
    copyCommandButton?.click();
    await nextTick();

    const copyTemplateButtons =
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid='task-detail-copy-template-command']",
      );
    const copyTemplateButton =
      copyTemplateButtons[copyTemplateButtons.length - 1] ?? null;
    expect(copyTemplateButton).not.toBeNull();
    copyTemplateButton?.click();
    await nextTick();

    const copyLogsButtons = document.querySelectorAll<HTMLButtonElement>(
      "[data-testid='task-detail-copy-logs']",
    );
    const copyLogsButton =
      copyLogsButtons[copyLogsButtons.length - 1] ?? null;
    expect(copyLogsButton).not.toBeNull();
    copyLogsButton?.click();
    await nextTick();

    const calls = (writeTextMock as any).mock.calls.map((args: unknown[]) => args[0]);
    expect(calls).toContain(job.ffmpegCommand);
    expect(calls).toContain(expectedTemplate);
    expect(calls).toContain(job.logs.join("\n"));

    (navigator as any).clipboard = originalClipboard;
  });

  it("renders logs without injecting extra blank rows or artificial line breaks", async () => {
    const rawLog = [
      "ffmpeg version n6.1.1 Copyright (c) 2000-2024 the FFmpeg developers",
      "",
      "frame=  10 fps=0.0 q=-1.0 size=       0kB time=00:00:00.33 bitrate=   0.0kbits/s speed=0.66x",
      "",
      "ffmpeg exited with non-zero status (exit code 1)",
      "",
    ].join("\n");

    const job: TranscodeJob = {
      id: "job-logs-spacing",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-logs-spacing",
      status: "failed",
      progress: 100,
      startTime: Date.now() - 4000,
      endTime: Date.now(),
      logs: rawLog.split("\n"),
      logTail: rawLog,
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
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

    const logsEl =
      (Array.from(
        document.querySelectorAll<HTMLElement>("[data-testid='task-detail-logs']"),
      ).find((el) =>
        (el.textContent ?? "").includes(
          "frame=  10 fps=0.0 q=-1.0 size=       0kB time=00:00:00.33 bitrate=   0.0kbits/s speed=0.66x",
        ),
      ) as HTMLElement | null) ?? null;
    expect(logsEl).not.toBeNull();

    const logsHtml = logsEl!.innerHTML;
    // jsdom serializes the injected HTML string; because we concatenate
    // individual <div> blocks without newline separators, there should be no
    // stray newline characters that would render as blank rows under
    // `whitespace-pre-wrap`.
    expect(logsHtml.includes("\n")).toBe(false);
  });

  it("collapses structured ffmpeg -progress blocks into a single visual row", async () => {
    const rawLog = [
      'command: ffmpeg -progress pipe:2 -i "input.mp4" -c:v hevc_nvenc -cq 28 -preset p5 -c:a copy "output.mp4"',
      "ffmpeg version 6.1-full_build-www.gyan.dev Copyright (c) 2000-2023 the FFmpeg developers",
      "frame=    0 fps=0.0 q=0.0 size=       0kB time=00:00:00.46 bitrate=   0.8kbits/s speed=25.8x",
      "frame=0",
      "fps=0.00",
      "stream_0_0_q=0.0",
      "bitrate=   0.8kbits/s",
      "total_size=44",
      "out_time_us=464399",
      "out_time_ms=464399",
      "out_time=00:00:00.464399",
      "dup_frames=0",
      "drop_frames=0",
      "speed=25.8x",
      "progress=continue",
    ].join("\n");

    const job: TranscodeJob = {
      id: "job-structured-progress",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-structured-progress",
      status: "processing",
      progress: 50,
      startTime: Date.now() - 4000,
      logs: rawLog.split("\n"),
      logTail: rawLog,
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand:
        'ffmpeg -progress pipe:2 -i "C:/videos/sample.mp4" -c:v hevc_nvenc -cq 28 -preset p5 -c:a copy "C:/videos/sample.compressed.mp4"',
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

    const logsEl =
      (Array.from(
        document.querySelectorAll<HTMLElement>("[data-testid='task-detail-logs']"),
      ).find((el) => (el.textContent ?? "").includes("out_time=00:00:00.464399")) as
        | HTMLElement
        | null) ?? null;
    expect(logsEl).not.toBeNull();

    const lineTexts = Array.from(logsEl!.querySelectorAll<HTMLDivElement>("div"))
      .map((el) => (el.textContent ?? "").trim())
      .filter((text) => text.length > 0);



    // Structured key=value lines from `-progress pipe:2` should not each
    // render as their own visual row.
    const singles = [
      "frame=0",
      "fps=0.00",
      "stream_0_0_q=0.0",
      "bitrate=   0.8kbits/s",
      "total_size=44",
      "out_time_us=464399",
      "out_time_ms=464399",
      "dup_frames=0",
      "drop_frames=0",
      "speed=25.8x",
      "progress=continue",
    ];
    for (const single of singles) {
      expect(
        lineTexts.includes(single),
      ).toBe(false);
    }

    // Instead, they should be merged into a single synthetic progress row
    // that still exposes all key fields for readability.
    const merged = lineTexts.find(
      (line) =>
        line.includes("frame=0") &&
        line.includes("fps=0.00") &&
        line.includes("bitrate=0.8kbits/s") &&
        line.includes("out_time=00:00:00.464399") &&
        line.includes("speed=25.8x") &&
        line.includes("progress=continue"),
    );
    expect(merged).toBeDefined();
  });

  it("prefers full logs over truncated logTail so the beginning of the log is preserved", async () => {
    const lines = [
      "ffmpeg version n6.1.1 Copyright (c) 2000-2024 the FFmpeg developers",
      "frame=  10 fps=0.0 q=-1.0 size=       0kB time=00:00:00.33 bitrate=   0.0kbits/s speed=0.66x",
      "ffmpeg exited with non-zero status (exit code 1)",
    ];
    const fullLog = lines.join("\n");
    // Simulate a backend-provided tail that has already dropped the first line.
    const truncatedTail = fullLog.slice(fullLog.indexOf("\n") + 1);

    const job: TranscodeJob = {
      id: "job-long-log-truncated-tail",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-long-log",
      status: "failed",
      progress: 100,
      startTime: Date.now() - 4000,
      endTime: Date.now(),
      logs: fullLog.split("\n"),
      logTail: truncatedTail,
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
      ffmpegCommand:
        'ffmpeg -i "C:/videos/sample.mp4" -c:v libx264 -crf 23 "C:/videos/sample.compressed.mp4"',
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

    const logsEls = document.querySelectorAll<HTMLElement>(
      "[data-testid='task-detail-logs']",
    );
    const logsEl = logsEls[logsEls.length - 1] ?? null;
    expect(logsEl).not.toBeNull();

    const logsText = logsEl!.textContent ?? "";
    expect(logsText).toContain(
      "ffmpeg version n6.1.1 Copyright (c) 2000-2024 the FFmpeg developers",
    );
  });

});
