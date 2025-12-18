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

describe("JobCompareDialog playback sync", () => {
  beforeEach(() => {
    (getJobCompareSources as any).mockReset();
  });

  it("does not re-seek the master video while playing (prevents occasional frame desync)", async () => {
    vi.useFakeTimers();

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let rafId = 0;
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      const id = (rafId += 1);
      rafCallbacks.set(id, cb);
      return id as unknown as number;
    });
    const cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
      rafCallbacks.delete(id);
    });

    const runOneRafTick = () => {
      const pending = Array.from(rafCallbacks.values());
      rafCallbacks.clear();
      for (const cb of pending) cb(0);
    };

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

    try {
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const inputVideo = wrapper.element.querySelector('video[data-compare-side="input"]') as HTMLVideoElement | null;
      const outputVideo = wrapper.element.querySelector('video[data-compare-side="output"]') as HTMLVideoElement | null;
      expect(inputVideo).toBeTruthy();
      expect(outputVideo).toBeTruthy();

      let inputTime = 0;
      let outputTime = 0;
      let inputSets = 0;

      Object.defineProperty(inputVideo!, "currentTime", {
        configurable: true,
        get: () => inputTime,
        set: (v) => {
          inputTime = Number(v);
          inputSets += 1;
        },
      });
      Object.defineProperty(outputVideo!, "currentTime", {
        configurable: true,
        get: () => outputTime,
        set: (v) => {
          outputTime = Number(v);
        },
      });
      Object.defineProperty(inputVideo!, "paused", { configurable: true, get: () => false });
      Object.defineProperty(outputVideo!, "paused", { configurable: true, get: () => false });
      Object.defineProperty(inputVideo!, "ended", { configurable: true, get: () => false });
      Object.defineProperty(inputVideo!, "readyState", { configurable: true, get: () => 4 });
      Object.defineProperty(outputVideo!, "readyState", { configurable: true, get: () => 4 });

      (inputVideo! as any).play = vi.fn(async () => undefined);
      (outputVideo! as any).play = vi.fn(async () => undefined);
      (inputVideo! as any).pause = vi.fn(() => undefined);
      (outputVideo! as any).pause = vi.fn(() => undefined);

      // Flush any pending seek scheduled by the initial timeline watcher.
      runOneRafTick();
      await wrapper.vm.$nextTick();
      const baselineBeforePlay = inputSets;

      await wrapper.get('[data-testid="job-compare-toggle-play"]').trigger("click");
      await wrapper.vm.$nextTick();
      const baselineAfterStart = inputSets;
      expect(baselineAfterStart).toBeGreaterThanOrEqual(baselineBeforePlay);

      // Simulate the master advancing to 1s and run a single playback sync tick.
      inputTime = 1.0;
      outputTime = 1.0;
      runOneRafTick();
      await wrapper.vm.$nextTick();

      // The fix: syncing updates the timeline without re-seeking the master.
      expect(inputSets).toBe(baselineAfterStart);
    } finally {
      wrapper.unmount();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("snaps output to the master's actual seek time when scrubbing (avoids stable off-by-one frames)", async () => {
    vi.useFakeTimers();

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let rafId = 0;
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      const id = (rafId += 1);
      rafCallbacks.set(id, cb);
      return id as unknown as number;
    });
    const cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
      rafCallbacks.delete(id);
    });

    const runRafFrame = () => {
      const pending = Array.from(rafCallbacks.values());
      rafCallbacks.clear();
      for (const cb of pending) cb(0);
    };

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

    try {
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      const inputVideo = wrapper.element.querySelector('video[data-compare-side="input"]') as HTMLVideoElement | null;
      const outputVideo = wrapper.element.querySelector('video[data-compare-side="output"]') as HTMLVideoElement | null;
      expect(inputVideo).toBeTruthy();
      expect(outputVideo).toBeTruthy();

      Object.defineProperty(inputVideo!, "paused", { configurable: true, get: () => true });
      Object.defineProperty(outputVideo!, "paused", { configurable: true, get: () => true });
      Object.defineProperty(inputVideo!, "readyState", { configurable: true, get: () => 4 });
      Object.defineProperty(outputVideo!, "readyState", { configurable: true, get: () => 4 });

      let inputRequested = 0;
      let inputActual = 0;
      let outputActual = 0;
      const outputSets: number[] = [];

      Object.defineProperty(inputVideo!, "currentTime", {
        configurable: true,
        get: () => inputActual,
        set: (v) => {
          inputRequested = Number(v);
          inputActual = Math.abs(inputRequested - 36.5) < 1e-6 ? 36.4666667 : inputRequested;
        },
      });
      Object.defineProperty(outputVideo!, "currentTime", {
        configurable: true,
        get: () => outputActual,
        set: (v) => {
          outputActual = Number(v);
          outputSets.push(outputActual);
        },
      });

      const slider = wrapper.get('[data-testid="job-compare-timeline"]');
      await slider.setValue("36.5");
      await wrapper.vm.$nextTick();

      runRafFrame();
      await Promise.resolve();
      runRafFrame();
      await Promise.resolve();
      runRafFrame();
      await Promise.resolve();

      expect(outputSets).toContain(36.5);
      expect(outputSets).toContain(36.4666667);
      expect(outputActual).toBeCloseTo(36.4666667, 6);
    } finally {
      wrapper.unmount();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
