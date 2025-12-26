// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null) => path,
    cleanupFallbackPreviewFramesAsync: vi.fn(async () => true),
    ensureJobPreview: vi.fn(async () => null),
    hasTauri: vi.fn(() => false),
    loadPreviewDataUrl: vi.fn(async () => null),
  };
});

vi.mock("@/lib/ffmpegCommand", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ffmpegCommand")>("@/lib/ffmpegCommand");
  return {
    ...actual,
    highlightFfmpegCommand: (command: string) => command,
    normalizeFfmpegTemplate: (command: string) => ({ template: `TEMPLATE(${command})` }),
  };
});

import JobDetailDialog from "@/components/dialogs/JobDetailDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

function makeJob(overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id: "job-1",
    filename: "C:/videos/sample.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    presetId: "preset-1",
    status: "queued",
    progress: 0,
    logs: [],
    ffmpegCommand: "ffmpeg -i input.mp4 output.mp4",
    ...overrides,
  };
}

describe("JobDetailDialog copy command", () => {
  it("copies the currently displayed (effective) command", async () => {
    const job = makeJob();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const wrapper = mount(JobDetailDialog, {
      props: {
        open: true,
        job,
        preset: null,
        jobDetailLogText: "",
        highlightedLogHtml: "",
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogScrollContent: { template: "<div><slot /></div>" },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    await wrapper.get('[data-testid="task-detail-copy-command"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(`TEMPLATE(${job.ffmpegCommand})`);
  });

  it("copies the resolved ffmpeg path when full command view is active", async () => {
    const resolvedPath = "C:/Program Files/FFmpeg/bin/ffmpeg.exe";
    const job = makeJob({
      status: "completed",
      ffmpegCommand: "ffmpeg -i input.mp4 output.mp4",
    });

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const wrapper = mount(JobDetailDialog, {
      props: {
        open: true,
        job,
        preset: null,
        jobDetailLogText: "",
        highlightedLogHtml: "",
        ffmpegResolvedPath: resolvedPath,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogScrollContent: { template: "<div><slot /></div>" },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    await wrapper.get('[data-testid="task-detail-copy-command"]').trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(`"${resolvedPath}" -i input.mp4 output.mp4`);
  });
});
