// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueCarousel3DView from "./QueueCarousel3DView.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => false,
    buildPreviewUrl: (path: string | null | undefined) => path ?? null,
    buildJobPreviewUrl: (path: string | null | undefined) => path ?? null,
    ensureJobPreview: vi.fn(async () => null),
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

const makeJob = (id: string): TranscodeJob =>
  ({
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 1,
    presetId: "p1",
    status: "queued",
    progress: 0,
    logs: [],
  }) as TranscodeJob;

const getActiveCardIndex = (wrapper: ReturnType<typeof mount>) => {
  const active = wrapper.get("[data-testid='ffui-carousel-3d-card'][data-active='true']");
  return Number(active.attributes("data-index"));
};

describe("QueueCarousel3DView wheel soft snap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("accumulates small deltas before stepping (trackpad-friendly)", async () => {
    const items: QueueListItem[] = Array.from({ length: 3 }, (_, idx) => ({
      kind: "job" as const,
      job: makeJob(`job-${idx + 1}`),
    }));

    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items,
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Badge: true,
          Button: true,
          Progress: true,
          QueueJobWarnings: true,
        },
      },
    });

    const container = wrapper.get("[data-testid='ffui-carousel-3d-container']").element;
    expect(getActiveCardIndex(wrapper)).toBe(0);

    for (let i = 0; i < 3; i++) {
      const wheel = new WheelEvent("wheel", { deltaY: 10, cancelable: true, deltaMode: 0 });
      container.dispatchEvent(wheel);
      await wrapper.vm.$nextTick();
    }

    const stillNotEnough = new WheelEvent("wheel", { deltaY: 5, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(stillNotEnough);
    await wrapper.vm.$nextTick();

    expect(getActiveCardIndex(wrapper)).toBe(0);

    const wheel = new WheelEvent("wheel", { deltaY: 25, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(wheel);
    await wrapper.vm.$nextTick();

    expect(getActiveCardIndex(wrapper)).toBe(1);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("locks steps briefly so a single gesture doesn't jump multiple cards", async () => {
    const items: QueueListItem[] = Array.from({ length: 4 }, (_, idx) => ({
      kind: "job" as const,
      job: makeJob(`job-${idx + 1}`),
    }));

    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items,
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Badge: true,
          Button: true,
          Progress: true,
          QueueJobWarnings: true,
        },
      },
    });

    const container = wrapper.get("[data-testid='ffui-carousel-3d-container']").element;

    const first = new WheelEvent("wheel", { deltaY: 140, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(first);
    await wrapper.vm.$nextTick();
    expect(getActiveCardIndex(wrapper)).toBe(1);

    const second = new WheelEvent("wheel", { deltaY: 140, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(second);
    await wrapper.vm.$nextTick();
    expect(getActiveCardIndex(wrapper)).toBe(1);

    vi.advanceTimersByTime(220);
    await wrapper.vm.$nextTick();

    const third = new WheelEvent("wheel", { deltaY: 140, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(third);
    await wrapper.vm.$nextTick();
    expect(getActiveCardIndex(wrapper)).toBe(2);
  });
});
