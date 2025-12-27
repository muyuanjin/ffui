// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  const loadPreviewDataUrl = vi.fn(async (path: string) => `data:image/jpeg;base64,TEST:${path}`);
  const ensureJobPreview = vi.fn(async () => null);

  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision && hasTauri() ? `${path}?ffuiPreviewRev=${revision}` : path,
    hasTauri,
    loadPreviewDataUrl,
    ensureJobPreview,
  };
});

import { ensureJobPreview, hasTauri, loadPreviewDataUrl } from "@/lib/backend";
import { resetJobPreviewWarmupForTests } from "@/lib/jobPreviewWarmup";
import { resetPreviewAutoEnsureForTests } from "@/components/queue-item/previewAutoEnsure";
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
    (ensureJobPreview as any).mockReset();
    resetJobPreviewWarmupForTests();
    resetPreviewAutoEnsureForTests();
  });

  it("toggles selection instead of opening details when card is clicked in selectable mode", async () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/icon.jpg",
      status: "processing",
    });

    const wrapper = mount(QueueIconItem, {
      props: {
        job,
        size: "medium",
        progressStyle: "bar",
        canSelect: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const card = wrapper.get("[data-testid='queue-icon-item']");
    await card.trigger("click");

    const selectEvents = wrapper.emitted("toggle-select");
    const inspectEvents = wrapper.emitted("inspect");

    expect(selectEvents).toBeTruthy();
    expect(selectEvents?.[0]?.[0]).toBe(job.id);
    expect(inspectEvents).toBeFalsy();
  });

  it("renders a stronger visual highlight when the item is selected", () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/icon.jpg",
      status: "processing",
    });

    const wrapper = mount(QueueIconItem, {
      props: {
        job,
        size: "medium",
        progressStyle: "bar",
        canSelect: true,
        selected: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const card = wrapper.get("[data-testid='queue-icon-item']");
    const classes = card.classes();
    expect(classes).toContain("ring-inset");
    expect(classes.some((value) => value === "ring-2" || value === "!ring-2")).toBe(true);
  });

  it("uses the dedicated detail button to emit inspect without toggling selection", async () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/icon.jpg",
      status: "processing",
    });

    const wrapper = mount(QueueIconItem, {
      props: {
        job,
        size: "medium",
        progressStyle: "bar",
        canSelect: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const detailButton = wrapper.get("[data-testid='queue-icon-item-detail-button']");
    await detailButton.trigger("click");

    const inspectEvents = wrapper.emitted("inspect");
    const selectEvents = wrapper.emitted("toggle-select");

    expect(inspectEvents).toBeTruthy();
    expect(inspectEvents?.[0]?.[0]).toEqual(job);
    expect(selectEvents).toBeFalsy();
  });

  it("renders a compare button and disables it when Tauri is unavailable", () => {
    const job = makeJob({
      status: "completed",
      outputPath: "C:/videos/sample.compressed.mp4",
    });

    (hasTauri as any).mockReturnValue(false);

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

    const compareButton = wrapper.get("[data-testid='queue-icon-item-compare-button']");
    expect((compareButton.element as HTMLButtonElement).disabled).toBe(true);
    expect(compareButton.attributes("title")).toBe((en as any).jobCompare.requiresTauri);
  });

  it("emits compare when the compare button is clicked", async () => {
    const job = makeJob({
      status: "completed",
      outputPath: "C:/videos/sample.compressed.mp4",
    });

    (hasTauri as any).mockReturnValue(true);

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

    const compareButton = wrapper.get("[data-testid='queue-icon-item-compare-button']");
    expect((compareButton.element as HTMLButtonElement).disabled).toBe(false);

    await compareButton.trigger("click");
    expect(wrapper.emitted("compare")?.[0]?.[0]).toEqual(job);
  });

  it("renders a non-disappearing warning icon when job has warnings", () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/icon.jpg",
      warnings: [{ code: "forcedContainerFallback", message: "fallback test" }],
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

    expect(wrapper.find("button[aria-label='Warnings']").exists()).toBe(true);
  });

  it("emits preview only (no inspect) when thumbnail image is clicked", async () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/icon.jpg",
      status: "completed",
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

    const img = wrapper.get("img");
    await img.trigger("click");

    const previewEvents = wrapper.emitted("preview");
    const inspectEvents = wrapper.emitted("inspect");

    expect(previewEvents).toBeTruthy();
    expect(previewEvents?.[0]?.[0]).toEqual(job);
    expect(inspectEvents).toBeFalsy();
  });

  it("auto-generates previews on mount when previewPath is missing (Tauri mode)", async () => {
    vi.useFakeTimers();
    try {
      const job = makeJob({ previewPath: undefined, status: "processing" });
      (hasTauri as any).mockReturnValue(true);
      (ensureJobPreview as any).mockResolvedValueOnce("C:/app-data/previews/autogen.jpg");

      mount(QueueIconItem, {
        props: {
          job,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await vi.runAllTimersAsync();

      expect(ensureJobPreview).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it("does not request backend preview generation when previewPath is missing for non-video jobs in Tauri mode", () => {
    const job = makeJob({ type: "image", status: "processing", progress: 0, previewPath: undefined });
    (hasTauri as any).mockReturnValue(true);

    mount(QueueIconItem, {
      props: {
        job,
        size: "medium",
        progressStyle: "card-fill",
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(ensureJobPreview).toHaveBeenCalledTimes(0);
  });

  it("regenerates preview when thumbnail is missing in Tauri mode", async () => {
    const job = makeJob({
      previewPath: "C:/app-data/previews/icon.jpg",
      status: "completed",
    });

    (hasTauri as any).mockReturnValue(true);
    (loadPreviewDataUrl as any).mockRejectedValueOnce(new Error("preview missing"));
    (ensureJobPreview as any).mockResolvedValueOnce("C:/app-data/previews/regenerated.jpg");

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

    const vm: any = wrapper.vm;
    await vm.handlePreviewError();

    expect(loadPreviewDataUrl).toHaveBeenCalledTimes(1);
    expect(ensureJobPreview).toHaveBeenCalledTimes(1);
    expect(ensureJobPreview).toHaveBeenCalledWith(job.id);

    const img = wrapper.get("img");
    expect(img.attributes("src")).toBe("C:/app-data/previews/regenerated.jpg");
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
    expect(barEl.style.transform).toBe("translateX(-58%)");
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

    const cardFillContainer = cardFillWrapper.get("[data-testid='queue-icon-item-progress-card-fill']");
    const cardFillEl = cardFillContainer.element as HTMLDivElement;
    expect(cardFillEl.style.transform).toBe("translateX(-58%)");

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

    const rippleContainer = rippleWrapper.get("[data-testid='queue-icon-item-progress-ripple-card']");
    const rippleEl = rippleContainer.element as HTMLDivElement;
    expect(rippleEl.style.transform).toBe("translateX(-58%)");

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

    const belowContainer = belowWrapper.get("[data-testid='queue-icon-item-progress-card-fill']");
    const belowEl = belowContainer.element as HTMLDivElement;
    expect(belowEl.style.transform).toBe("translateX(-100%)");

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

    const aboveContainer = aboveWrapper.get("[data-testid='queue-icon-item-progress-card-fill']");
    const aboveEl = aboveContainer.element as HTMLDivElement;
    expect(aboveEl.style.transform).toBe("translateX(-0%)");
  });

  it("keeps the progress bar in normal flow to avoid overlapping caption text", () => {
    const job = makeJob({
      status: "completed",
      progress: 100,
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

    const progressContainer = wrapper.get("[data-testid='queue-icon-item-progress-container']");
    expect(progressContainer.classes()).toContain("mt-1.5");
    expect(progressContainer.classes()).not.toContain("absolute");
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

    const container = wrapper.get("[data-testid='queue-icon-item-progress-card-fill']");
    const el = container.element as HTMLDivElement;
    expect(el.style.transform).toBe("translateX(-0%)");
  });
});
