import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  const loadPreviewDataUrl = vi.fn(
    async (path: string) => `data:image/jpeg;base64,TEST:${path}`,
  );

  return {
    buildPreviewUrl: (path: string | null) => path,
    hasTauri,
    loadPreviewDataUrl,
  };
});

import { hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import QueueIconItem from "@/components/QueueIconItem.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

function makeJob(overrides: Partial<TranscodeJob> = {}): TranscodeJob {
  return {
    id: overrides.id ?? "job-1",
    filename: overrides.filename ?? "C:/videos/sample.mp4",
    type: overrides.type ?? "video",
    source: overrides.source ?? "manual",
    originalSizeMB: overrides.originalSizeMB ?? 10,
    presetId: overrides.presetId ?? "preset-1",
    status: overrides.status ?? "processing",
    progress: overrides.progress ?? 0,
    logs: overrides.logs ?? [],
    ...overrides,
  };
}

describe("QueueIconItem", () => {
  beforeEach(() => {
    (hasTauri as any).mockReset();
    (hasTauri as any).mockReturnValue(false);
    (loadPreviewDataUrl as any).mockReset();
  });

  it("renders a stable placeholder when previewPath is missing", () => {
    const job = makeJob({ previewPath: undefined });

    const wrapper = mount(QueueIconItem, {
      props: {
        job,
        size: "medium",
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const card = wrapper.get("[data-testid='queue-icon-item']");
    // `get` 会在找不到元素时直接抛错，这里只断言包装的 DOM 节点存在即可。
    expect(card.element).toBeTruthy();
    const imgs = card.findAll("img");
    expect(imgs.length).toBe(0);
  });

  it("maps bar progress style to horizontal fill width", () => {
    const job = makeJob({
      status: "processing",
      progress: 42,
      previewPath: "C:/app-data/previews/icon.jpg",
    });

    const wrapper = mount(QueueIconItem, {
      props: {
        job,
        size: "medium",
        progressStyle: "bar",
      },
      global: {
        plugins: [i18n],
      },
    });

    const bar = wrapper.get("[data-testid='queue-icon-item-progress-bar']");
    const barEl = bar.element as HTMLDivElement;
    expect(barEl.style.width).toBe("42%");
  });

  it("maps card-fill and ripple-card progress styles to horizontal fill width and clamps to [0, 100]", () => {
    const base = makeJob({
      status: "processing",
      progress: 42,
      previewPath: "C:/app-data/previews/icon.jpg",
    });

    const cardFillWrapper = mount(QueueIconItem, {
      props: {
        job: base,
        size: "medium",
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const cardFillContainer = cardFillWrapper.get(
      "[data-testid='queue-icon-item-progress-card-fill']",
    );
    const cardFillEl = cardFillContainer.element as HTMLDivElement;
    expect(cardFillEl.style.width).toBe("42%");

    const rippleWrapper = mount(QueueIconItem, {
      props: {
        job: base,
        size: "medium",
        progressStyle: "ripple-card",
      },
      global: {
        plugins: [i18n],
      },
    });

    const rippleContainer = rippleWrapper.get(
      "[data-testid='queue-icon-item-progress-ripple-card']",
    );
    const rippleEl = rippleContainer.element as HTMLDivElement;
    expect(rippleEl.style.width).toBe("42%");

    const belowZero = makeJob({
      status: "processing",
      progress: -10,
      previewPath: "C:/app-data/previews/icon.jpg",
    });

    const belowWrapper = mount(QueueIconItem, {
      props: {
        job: belowZero,
        size: "medium",
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const belowContainer = belowWrapper.get(
      "[data-testid='queue-icon-item-progress-card-fill']",
    );
    const belowEl = belowContainer.element as HTMLDivElement;
    expect(belowEl.style.width).toBe("0%");

    const aboveHundred = makeJob({
      status: "processing",
      progress: 250,
      previewPath: "C:/app-data/previews/icon.jpg",
    });

    const aboveWrapper = mount(QueueIconItem, {
      props: {
        job: aboveHundred,
        size: "medium",
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const aboveContainer = aboveWrapper.get(
      "[data-testid='queue-icon-item-progress-card-fill']",
    );
    const aboveEl = aboveContainer.element as HTMLDivElement;
    expect(aboveEl.style.width).toBe("100%");
  });

  it("treats cancelled jobs as fully progressed for icon cards to match aggregated header progress", () => {
    const cancelledJob = makeJob({
      status: "cancelled",
      // Backend keeps cancelled progress at 0, but aggregated queue progress
      // treats Cancelled as 100% so the header/taskbar can reach completion.
      progress: 0,
      previewPath: "C:/app-data/previews/icon-cancelled.jpg",
    });

    const wrapper = mount(QueueIconItem, {
      props: {
        job: cancelledJob,
        size: "medium",
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    const container = wrapper.get(
      "[data-testid='queue-icon-item-progress-card-fill']",
    );
    const el = container.element as HTMLDivElement;
    expect(el.style.width).toBe("100%");
  });
});
