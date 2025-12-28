// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const MAX_RENDERED_ROWS_FOR_TEST = 30;

vi.mock("virtua/vue", async () => {
  const { defineComponent, h } = await import("vue");

  const VList = defineComponent({
    props: {
      data: { type: Array, required: true },
      bufferSize: { type: Number, required: false, default: undefined },
      itemSize: { type: Number, required: false, default: undefined },
    },
    setup(props, { slots }) {
      return () => {
        const items = (props.data as unknown[]).slice(0, MAX_RENDERED_ROWS_FOR_TEST);
        return h(
          "div",
          {
            "data-testid": "virtua-vlist-stub",
            "data-buffer-size": String(props.bufferSize ?? ""),
            "data-item-size": String(props.itemSize ?? ""),
          },
          items.flatMap((item, index) => slots.default?.({ item, index }) ?? []),
        );
      };
    },
  });

  return { VList };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const t = (key: string) => String((i18n.global as any).t(key));

const queueItemStub = {
  props: ["job", "preset", "canCancel", "viewMode", "progressStyle"],
  template: `<div data-testid="queue-item-stub" :data-job-id="job.id">{{ job.filename }}</div>`,
};

let QueuePanelComponent: any;

beforeAll(async () => {
  QueuePanelComponent = (await import("@/components/panels/QueuePanel.vue")).default;
});

function buildJob(id: string, status: TranscodeJob["status"]): TranscodeJob {
  return {
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: "p1",
    status,
    progress: 0,
    logs: [],
  };
}

function buildListItems(jobs: TranscodeJob[]): QueueListItem[] {
  return jobs.map((job) => ({ kind: "job", job }) as QueueListItem);
}

function mountQueuePanel(overrides: Partial<any>) {
  return mount(QueuePanelComponent, {
    attrs: { style: "height: 600px; width: 800px;" },
    props: {
      queueJobsForDisplay: [],
      visibleQueueItems: [],
      iconViewItems: [],
      queueModeProcessingJobs: [],
      queueModeWaitingItems: [],
      queueModeWaitingBatchIds: new Set<string>(),
      pausingJobIds: new Set<string>(),
      presets: [],
      queueViewMode: "list",
      ffmpegResolvedPath: null,
      queueProgressStyle: "bar",
      queueMode: "display",
      isIconViewMode: false,
      isCarousel3dViewMode: false,
      carouselAutoRotationSpeed: 0,
      iconViewSize: "medium",
      iconGridClass: "",
      queueRowVariant: "detail",
      progressUpdateIntervalMs: 250,
      hasBatchCompressBatches: false,
      activeStatusFilters: new Set(),
      activeTypeFilters: new Set(),
      filterText: "",
      filterUseRegex: false,
      filterRegexError: null,
      sortPrimary: "filename",
      sortPrimaryDirection: "asc",
      hasSelection: false,
      hasActiveFilters: false,
      selectedJobIds: new Set<string>(),
      selectedCount: 0,
      expandedBatchIds: new Set<string>(),
      ...overrides,
    },
    global: {
      plugins: [i18n],
      stubs: {
        QueueItem: queueItemStub,
      },
    },
  });
}

describe("QueuePanel virtual list wiring", () => {
  it("passes bufferSize in pixels (virtua) instead of item-based overscan", async () => {
    const jobs = Array.from({ length: 10 }, (_, idx) => buildJob(`job-${idx}`, "queued"));
    const items = buildListItems(jobs);

    const wrapper = mountQueuePanel({
      queueMode: "display",
      queueJobsForDisplay: jobs,
      visibleQueueItems: items,
      queueRowVariant: "detail",
    });

    const vlist = wrapper.find("[data-testid='virtua-vlist-stub']");
    expect(vlist.exists()).toBe(true);
    expect(vlist.attributes("data-item-size")).toBe("188");
    expect(vlist.attributes("data-buffer-size")).toBe("376");

    await wrapper.setProps({ queueRowVariant: "compact" });
    const vlistAfterCompact = wrapper.find("[data-testid='virtua-vlist-stub']");
    expect(vlistAfterCompact.attributes("data-item-size")).toBe("128");
    expect(vlistAfterCompact.attributes("data-buffer-size")).toBe("256");
  });

  it("does not render the full list in display mode", async () => {
    const jobs = Array.from({ length: 1000 }, (_, idx) => buildJob(`job-${idx}`, "queued"));
    const items = buildListItems(jobs);

    const wrapper = mountQueuePanel({
      queueMode: "display",
      queueJobsForDisplay: jobs,
      visibleQueueItems: items,
    });

    expect(wrapper.find("[data-testid='virtua-vlist-stub']").exists()).toBe(true);
    expect(wrapper.findAll("[data-testid='queue-item-stub']").length).toBe(MAX_RENDERED_ROWS_FOR_TEST);
  });

  it("uses flex sizing for VList container (avoid 0-height blanks)", async () => {
    const jobs = Array.from({ length: 10 }, (_, idx) => buildJob(`job-${idx}`, "queued"));
    const items = buildListItems(jobs);

    const wrapper = mountQueuePanel({
      queueMode: "display",
      queueJobsForDisplay: jobs,
      visibleQueueItems: items,
    });

    const vlist = wrapper.find("[data-testid='virtua-vlist-stub']");
    expect(vlist.exists()).toBe(true);
    expect(vlist.classes()).toContain("flex-1");
    expect(vlist.classes()).toContain("min-h-0");

    const listWrapper = vlist.element.parentElement;
    expect(listWrapper?.className).toContain("flex");
    expect(listWrapper?.className).toContain("flex-col");
  });

  it("renders FLIP keys on an inner wrapper (avoid conflicting with virtua transforms)", async () => {
    const jobs = Array.from({ length: 10 }, (_, idx) => buildJob(`job-${idx}`, "queued"));
    const items = buildListItems(jobs);

    const wrapper = mountQueuePanel({
      queueMode: "display",
      queueJobsForDisplay: jobs,
      visibleQueueItems: items,
      queueRowVariant: "detail",
    });

    const vlist = wrapper.find("[data-testid='virtua-vlist-stub']");
    expect(vlist.exists()).toBe(true);

    const vlistEl = vlist.element as HTMLElement;
    const directChildren = Array.from(vlistEl.children) as HTMLElement[];
    expect(directChildren.length).toBeGreaterThan(0);
    for (const child of directChildren) {
      expect(child.dataset.queueFlipKey).toBeUndefined();
    }

    const flipNodes = wrapper.findAll("[data-queue-flip-key]");
    expect(flipNodes.length).toBeGreaterThan(0);
    const firstFlip = flipNodes[0]!.element as HTMLElement;
    expect(firstFlip.parentElement?.parentElement).toBe(vlistEl);
  });

  it("keeps queue-mode group headers inside the virtual list", async () => {
    const processingJobs = [buildJob("processing-1", "processing"), buildJob("processing-2", "processing")];
    const waitingJobs = Array.from({ length: 200 }, (_, idx) => buildJob(`waiting-${idx}`, "queued"));
    const waitingItems = buildListItems(waitingJobs);

    const wrapper = mountQueuePanel({
      queueMode: "queue",
      queueModeProcessingJobs: processingJobs,
      queueModeWaitingItems: waitingItems,
      queueModeWaitingBatchIds: new Set<string>(),
      queueJobsForDisplay: [...processingJobs, ...waitingJobs],
      visibleQueueItems: waitingItems,
    });

    expect(wrapper.text()).toContain(t("queue.groups.processing"));
    expect(wrapper.text()).toContain(t("queue.groups.waiting"));

    const processingHeader = wrapper.find("[data-queue-flip-key='group:processing']");
    expect(processingHeader.exists()).toBe(true);
    expect(processingHeader.text()).toContain("2");
    const processingDivider = processingHeader.element.querySelector("[aria-hidden='true']") as HTMLElement | null;
    expect(processingDivider?.className).toContain("border-t");

    const waitingHeader = wrapper.find("[data-queue-flip-key='group:waiting']");
    expect(waitingHeader.exists()).toBe(true);
    expect(waitingHeader.text()).toContain("200");
    const waitingDivider = waitingHeader.element.querySelector("[aria-hidden='true']") as HTMLElement | null;
    expect(waitingDivider?.className).toContain("border-t");

    expect(wrapper.findAll("[data-testid='queue-item-stub']").length).toBeGreaterThan(0);
    expect(wrapper.findAll("[data-testid='queue-item-stub']").length).toBeLessThanOrEqual(MAX_RENDERED_ROWS_FOR_TEST);
  });
});
