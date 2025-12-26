// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => true);
  const loadPreviewDataUrl = vi.fn(async (path: string) => `data:image/jpeg;base64,TEST:${path}`);
  const ensureJobPreview = vi.fn(async () => null);
  const cleanupFallbackPreviewFramesAsync = vi.fn(async () => true);

  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision && hasTauri() ? `${path}?ffuiPreviewRev=${revision}` : path,
    hasTauri,
    loadPreviewDataUrl,
    ensureJobPreview,
    cleanupFallbackPreviewFramesAsync,
  };
});

vi.mock("@/lib/ffmpegCommand", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ffmpegCommand")>("@/lib/ffmpegCommand");
  return {
    ...actual,
    highlightFfmpegCommand: (command: string) => command,
    normalizeFfmpegTemplate: (command: string) => ({ template: command }),
  };
});

import { cleanupFallbackPreviewFramesAsync, ensureJobPreview, loadPreviewDataUrl } from "@/lib/backend";
import { resetJobPreviewWarmupForTests } from "@/lib/jobPreviewWarmup";
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
    status: "completed",
    progress: 100,
    logs: [],
    previewPath: "C:/app-data/previews/abc123.jpg",
    ...overrides,
  };
}

describe("JobDetailDialog preview regeneration", () => {
  beforeEach(() => {
    (loadPreviewDataUrl as any).mockReset();
    (ensureJobPreview as any).mockReset();
    resetJobPreviewWarmupForTests();
  });

  it("requests backend preview generation when previewPath is missing in Tauri mode", () => {
    const job = makeJob({ previewPath: undefined });

    mount(JobDetailDialog, {
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

    expect(ensureJobPreview).toHaveBeenCalledTimes(1);
    expect(ensureJobPreview).toHaveBeenCalledWith(job.id);
  });

  it("regenerates preview when inline preview is missing in Tauri mode", async () => {
    const job = makeJob();

    (loadPreviewDataUrl as any).mockRejectedValueOnce(new Error("missing preview"));
    (ensureJobPreview as any).mockResolvedValueOnce("C:/app-data/previews/regenerated.jpg");

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

    const vm: any = wrapper.vm;
    await vm.handleInlinePreviewError();

    expect(loadPreviewDataUrl).toHaveBeenCalledTimes(1);
    expect(ensureJobPreview).toHaveBeenCalledTimes(1);
    expect(ensureJobPreview).toHaveBeenCalledWith(job.id);
    expect(vm.inlinePreviewUrl).toBe("C:/app-data/previews/regenerated.jpg");
  });

  it("cleans fallback preview frames when closing the dialog", async () => {
    const job = makeJob();
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

    expect(cleanupFallbackPreviewFramesAsync).toHaveBeenCalledTimes(0);
    await wrapper.setProps({ open: false });
    expect(cleanupFallbackPreviewFramesAsync).toHaveBeenCalledTimes(1);
  });
});
