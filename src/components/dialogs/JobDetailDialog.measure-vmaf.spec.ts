// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";

const hasTauriMock = vi.fn(() => true);

vi.mock("@/lib/backend", () => {
  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null) => path,
    cleanupFallbackPreviewFramesAsync: vi.fn(async () => true),
    ensureJobPreview: vi.fn(async () => null),
    hasTauri: () => hasTauriMock(),
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

describe("JobDetailDialog measure VMAF", () => {
  beforeEach(() => {
    hasTauriMock.mockReset();
    hasTauriMock.mockReturnValue(true);
  });

  it("shows the measure button for video jobs in Tauri and enables it only when completed with paths", async () => {
    const job = makeJob({ status: "queued" });

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

    const btn = wrapper.find('[data-testid="task-detail-measure-vmaf"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeDefined();

    await wrapper.setProps({
      job: makeJob({
        status: "completed",
        inputPath: "C:/videos/sample.mp4",
        outputPath: "C:/videos/sample.compressed.mp4",
      }),
    });
    expect(wrapper.find('[data-testid="task-detail-measure-vmaf"]').attributes("disabled")).toBeUndefined();
  });

  it("does not show the measure button when not running under Tauri", () => {
    hasTauriMock.mockReturnValue(false);
    const job = makeJob({
      status: "completed",
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
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

    expect(wrapper.find('[data-testid="task-detail-measure-vmaf"]').exists()).toBe(false);
  });

  it("emits measureVmaf with a 30s default slice", async () => {
    const job = makeJob({
      status: "completed",
      inputPath: "C:/videos/sample.mp4",
      outputPath: "C:/videos/sample.compressed.mp4",
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

    await wrapper.get('[data-testid="task-detail-measure-vmaf"]').trigger("click");

    expect(wrapper.emitted("measureVmaf")).toEqual([[{ jobId: "job-1", trimSeconds: 30 }]]);
  });
});
