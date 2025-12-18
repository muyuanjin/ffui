// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { JobCompareSources, TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: vi.fn(() => true),
    getJobCompareSources: vi.fn(async () => null),
    extractJobCompareFrame: vi.fn(async () => "C:/previews/input.jpg"),
    extractJobCompareConcatFrame: vi.fn(async () => "C:/previews/output.jpg"),
    buildPreviewUrl: (path: string | null) => path,
    buildPlayableMediaUrl: (path: string | null) => path,
    loadPreviewDataUrl: vi.fn(async (path: string) => `data:image/jpeg;base64,TEST:${path}`),
  };
});

import { getJobCompareSources } from "@/lib/backend";
import { extractJobCompareConcatFrame, extractJobCompareFrame } from "@/lib/backend";
import JobCompareDialog from "@/components/dialogs/JobCompareDialog.vue";

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
    filename: "C:/videos/input.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    presetId: "preset-1",
    status: "paused",
    progress: 10,
    logs: [],
    mediaInfo: { durationSeconds: 120 },
    waitMetadata: { segments: ["C:/tmp/seg0.mp4", "C:/tmp/seg1.mp4"], tmpOutputPath: "C:/tmp/seg1.mp4" },
    ...overrides,
  };
}

const stubs = {
  Dialog: { template: "<div><slot /></div>" },
  DialogContent: { template: "<div><slot /></div>" },
  DialogHeader: { template: "<div><slot /></div>" },
  DialogTitle: { template: "<div><slot /></div>" },
  DialogDescription: { template: "<div><slot /></div>" },
  Slider: {
    inheritAttrs: false,
    props: ["modelValue", "max"],
    emits: ["update:modelValue", "valueCommit"],
    template: `<input type="range" v-bind="$attrs" :max="max" :value="(modelValue && modelValue[0]) || 0" @input="$emit('update:modelValue',[Number($event.target.value)])" />`,
  },
  Button: {
    inheritAttrs: false,
    props: ["disabled"],
    template: `<button v-bind="$attrs" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
  },
};

describe("JobCompareDialog", () => {
  beforeEach(() => {
    (getJobCompareSources as any).mockReset();
    (extractJobCompareFrame as any).mockClear?.();
    (extractJobCompareConcatFrame as any).mockClear?.();
  });

  it("clamps timeline to maxCompareSeconds for partial jobs", async () => {
    const sources: JobCompareSources = {
      jobId: "job-1",
      inputPath: "C:/videos/input.mp4",
      output: { kind: "partial", segmentPaths: ["C:/tmp/seg0.mp4", "C:/tmp/seg1.mp4"] },
      maxCompareSeconds: 12.5,
    };
    (getJobCompareSources as any).mockResolvedValueOnce(sources);

    const wrapper = mount(JobCompareDialog, {
      props: { open: true, job: makeJob() },
      global: { plugins: [i18n], stubs },
    });

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const slider = wrapper.get('[data-testid="job-compare-timeline"]');
    await slider.setValue("99");

    const label = wrapper.get('[data-testid="job-compare-current-time"]').text();
    expect(label).toContain("00:12.5");
  });

  it("preserves zoom state across scrubbing and mode switches", async () => {
    const sources: JobCompareSources = {
      jobId: "job-1",
      inputPath: "C:/videos/input.mp4",
      output: { kind: "completed", outputPath: "C:/videos/output.mp4" },
      maxCompareSeconds: null,
    };
    (getJobCompareSources as any).mockResolvedValueOnce(sources);

    const wrapper = mount(JobCompareDialog, {
      props: { open: true, job: makeJob({ status: "completed", outputPath: "C:/videos/output.mp4" }) },
      global: { plugins: [i18n], stubs },
      attachTo: document.body,
    });

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const viewport = wrapper.get('[data-testid="job-compare-viewport"]');
    (viewport.element as any).getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const wheel = new WheelEvent("wheel", { deltaY: -120 });
    Object.defineProperty(wheel, "clientX", { value: 50 });
    Object.defineProperty(wheel, "clientY", { value: 40 });
    viewport.element.dispatchEvent(wheel);
    await wrapper.vm.$nextTick();

    const transformEl = wrapper.get('[data-testid="job-compare-transform-input"]');
    const before = transformEl.attributes("style");
    expect(before).toContain("scale(");

    const slider = wrapper.get('[data-testid="job-compare-timeline"]');
    await slider.setValue("5");
    await wrapper.vm.$nextTick();

    const afterScrub = transformEl.attributes("style");
    expect(afterScrub).toBe(before);

    await wrapper.get('[data-testid="job-compare-mode-wipe"]').trigger("click");
    await wrapper.vm.$nextTick();
    const afterModeInput = wrapper.get('[data-testid="job-compare-transform-wipe-input"]').attributes("style");
    const afterModeOutput = wrapper.get('[data-testid="job-compare-transform-wipe-output"]').attributes("style");
    expect(afterModeInput).toBe(before);
    expect(afterModeOutput).toBe(before);
  });

  it("requests low-quality frames while scrubbing and upgrades to high-quality after idle", async () => {
    vi.useFakeTimers();
    const sources: JobCompareSources = {
      jobId: "job-1",
      inputPath: "C:/videos/input.mp4",
      output: { kind: "partial", segmentPaths: ["C:/tmp/seg0.mp4", "C:/tmp/seg1.mp4"] },
      maxCompareSeconds: 12.5,
    };
    (getJobCompareSources as any).mockResolvedValueOnce(sources);

    const wrapper = mount(JobCompareDialog, {
      props: { open: true, job: makeJob() },
      global: { plugins: [i18n], stubs },
    });

    try {
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const slider = wrapper.get('[data-testid="job-compare-timeline"]');
      for (let i = 0; i < 10; i += 1) {
        await slider.setValue(String(i));
        await vi.advanceTimersByTimeAsync(20);
      }

      const lowCalls = (extractJobCompareFrame as any).mock.calls.filter((args: any[]) => args?.[0]?.quality === "low");
      expect(lowCalls.length).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(260);

      const highCalls = (extractJobCompareFrame as any).mock.calls.filter(
        (args: any[]) => args?.[0]?.quality === "high",
      );
      expect(highCalls.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });

  it("preserves timeline when comparing a different job with the same input", async () => {
    const sources: JobCompareSources = {
      jobId: "job-1",
      inputPath: "C:/videos/input.mp4",
      output: { kind: "completed", outputPath: "C:/videos/output.mp4" },
      maxCompareSeconds: null,
    };
    (getJobCompareSources as any).mockImplementation(async (jobId: string) => {
      return {
        ...sources,
        jobId,
        output: { kind: "completed", outputPath: `C:/videos/output-${jobId}.mp4` },
      };
    });

    const wrapper = mount(JobCompareDialog, {
      props: {
        open: true,
        job: makeJob({
          id: "job-1",
          filename: "C:/videos/input.mp4",
          status: "completed",
          outputPath: "C:/videos/output-job-1.mp4",
        }),
      },
      global: { plugins: [i18n], stubs },
    });

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const slider = wrapper.get('[data-testid="job-compare-timeline"]');
    await slider.setValue("5");
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="job-compare-current-time"]').text()).toContain("00:05");

    await wrapper.setProps({
      job: makeJob({
        id: "job-2",
        filename: "C:/videos/input.mp4",
        status: "completed",
        outputPath: "C:/videos/output-job-2.mp4",
      }),
    });
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="job-compare-current-time"]').text()).toContain("00:05");
  });

  it("resets timeline when comparing a job with a different input", async () => {
    const sources: JobCompareSources = {
      jobId: "job-1",
      inputPath: "C:/videos/input.mp4",
      output: { kind: "completed", outputPath: "C:/videos/output.mp4" },
      maxCompareSeconds: null,
    };
    (getJobCompareSources as any).mockImplementation(async (jobId: string) => {
      return {
        ...sources,
        jobId,
        inputPath: jobId === "job-1" ? "C:/videos/input-1.mp4" : "C:/videos/input-2.mp4",
        output: { kind: "completed", outputPath: `C:/videos/output-${jobId}.mp4` },
      };
    });

    const wrapper = mount(JobCompareDialog, {
      props: {
        open: true,
        job: makeJob({
          id: "job-1",
          filename: "C:/videos/input-1.mp4",
          status: "completed",
          outputPath: "C:/videos/output-job-1.mp4",
        }),
      },
      global: { plugins: [i18n], stubs },
    });

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const slider = wrapper.get('[data-testid="job-compare-timeline"]');
    await slider.setValue("5");
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="job-compare-current-time"]').text()).toContain("00:05");

    await wrapper.setProps({
      job: makeJob({
        id: "job-2",
        filename: "C:/videos/input-2.mp4",
        status: "completed",
        outputPath: "C:/videos/output-job-2.mp4",
      }),
    });
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="job-compare-current-time"]').text()).toContain("00:00");
  });

  it("preserves timeline when reopening compare for the same input", async () => {
    const sources: JobCompareSources = {
      jobId: "job-1",
      inputPath: "C:/videos/input.mp4",
      output: { kind: "completed", outputPath: "C:/videos/output.mp4" },
      maxCompareSeconds: null,
    };
    (getJobCompareSources as any).mockResolvedValue(sources);

    const wrapper = mount(JobCompareDialog, {
      props: {
        open: true,
        job: makeJob({
          id: "job-1",
          filename: "C:/videos/input.mp4",
          status: "completed",
          outputPath: "C:/videos/output.mp4",
        }),
      },
      global: { plugins: [i18n], stubs },
    });

    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const slider = wrapper.get('[data-testid="job-compare-timeline"]');
    await slider.setValue("5");
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="job-compare-current-time"]').text()).toContain("00:05");

    await wrapper.setProps({ open: false });
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ open: true });
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="job-compare-current-time"]').text()).toContain("00:05");
  });
});
