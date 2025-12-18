// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "./QueuePanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob, CompositeSmartScanTask } from "@/types";
import type { QueueListItem, QueueFilterStatus, QueueFilterKind } from "@/composables";

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
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

const basePreset: FFmpegPreset = {
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used in QueuePanel Smart Scan icon batch tests",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
};

const createChildJob = (id: string): TranscodeJob =>
  ({
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "smart_scan",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: basePreset.id,
    status: "waiting",
    progress: 0,
    logs: [],
    batchId: "batch-1",
  }) as TranscodeJob;

const createBatch = (jobs: TranscodeJob[]): CompositeSmartScanTask => ({
  batchId: "batch-1",
  rootPath: "C:/videos",
  jobs,
  totalFilesScanned: jobs.length,
  totalCandidates: jobs.length,
  totalProcessed: 0,
  startedAtMs: Date.now(),
  completedAtMs: undefined,
  overallProgress: 0,
  currentJob: null,
  completedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  totalCount: jobs.length,
});

const queueIconItemStub = {
  props: ["job", "size", "progressStyle", "canSelect", "selected"],
  template: `
    <div
      data-testid="queue-icon-item-stub"
      :data-job-id="job.id"
      :data-selected="String(!!selected)"
    />
  `,
};

const queueSmartScanIconBatchStub = {
  props: ["batch", "size", "progressStyle", "canSelect", "selected"],
  emits: ["open-detail", "toggle-select", "contextmenu-batch"],
  template: `
    <div
      data-testid="queue-icon-batch-stub"
      :data-batch-id="batch.batchId"
      :data-selected="String(!!selected)"
      @click="$emit('toggle-select')"
      @contextmenu.prevent="$emit('contextmenu-batch', { batch, event: $event })"
    />
  `,
};

describe("QueuePanel Smart Scan icon batch interactions", () => {
  const createWrapper = (selectedJobIds: Set<string>, jobs: TranscodeJob[]) => {
    const batch = createBatch(jobs);
    const items: QueueListItem[] = [{ kind: "batch", batch }];

    return mount(QueuePanel, {
      props: {
        // Queue items
        queueJobsForDisplay: jobs,
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        pausingJobIds: new Set<string>(),
        presets: [basePreset],

        // View settings
        queueViewMode: "icon-small",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "display",
        isIconViewMode: true,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: "grid-cols-1",
        queueRowVariant: "compact",
        progressUpdateIntervalMs: 500,
        hasSmartScanBatches: true,

        // Filter/sort state
        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "asc",
        hasSelection: selectedJobIds.size > 0,
        hasActiveFilters: false,
        selectedJobIds,
        selectedCount: selectedJobIds.size,

        // Batch expansion
        expandedBatchIds: new Set<string>(),

        // Error state
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueIconItem: queueIconItemStub,
          QueueSmartScanIconBatchItem: queueSmartScanIconBatchStub,
          QueueItem: true,
          QueueSmartScanBatchCard: true,
        },
      },
    });
  };

  it("当部分子任务已选中时，点击复合任务卡片应只为未选中的子任务触发 toggleJobSelected", async () => {
    const child1 = createChildJob("child-1");
    const child2 = createChildJob("child-2");
    const selected = new Set<string>([child1.id]);

    const wrapper = createWrapper(selected, [child1, child2]);

    const batchEl = wrapper.get("[data-testid='queue-icon-batch-stub']");
    expect(batchEl.attributes("data-selected")).toBe("false");

    await batchEl.trigger("click");

    const toggleEvents = wrapper.emitted("toggleJobSelected");
    expect(toggleEvents).toBeTruthy();
    // 仅为未选中的 child2 触发
    expect(toggleEvents?.[0]).toEqual([child2.id]);
  });

  it("当所有子任务已选中时，点击复合任务卡片应为该批次所有子任务触发 toggleJobSelected（视为取消选中该批次）", async () => {
    const child1 = createChildJob("child-1");
    const child2 = createChildJob("child-2");
    const selected = new Set<string>([child1.id, child2.id]);

    const wrapper = createWrapper(selected, [child1, child2]);

    const batchEl = wrapper.get("[data-testid='queue-icon-batch-stub']");
    // 所有子任务已选中时，复合卡片应标记为 selected
    expect(batchEl.attributes("data-selected")).toBe("true");

    await batchEl.trigger("click");

    const toggleEvents = wrapper.emitted("toggleJobSelected");
    expect(toggleEvents).toBeTruthy();
    // 两个子任务都应被“反选”
    expect(toggleEvents).toContainEqual([child1.id]);
    expect(toggleEvents).toContainEqual([child2.id]);
  });

  it("右键复合任务卡片时，应清空原有选中并只选中该批次子任务，然后以 bulk 模式打开右键菜单", async () => {
    const child1 = createChildJob("child-1");
    const child2 = createChildJob("child-2");
    // 初始包含其它选中任务，验证 clearSelection 被调用
    const selected = new Set<string>(["other-job"]);

    const wrapper = createWrapper(selected, [child1, child2]);

    const batchEl = wrapper.get("[data-testid='queue-icon-batch-stub']");
    await batchEl.trigger("contextmenu", { clientX: 10, clientY: 20 });

    const clearEvents = wrapper.emitted("clearSelection");
    expect(clearEvents).toBeTruthy();
    expect(clearEvents?.length).toBe(1);

    const toggleEvents = wrapper.emitted("toggleJobSelected") ?? [];
    const toggledIds = toggleEvents.map((e) => e[0]);
    expect(toggledIds).toContain(child1.id);
    expect(toggledIds).toContain(child2.id);

    const bulkMenuEvents = wrapper.emitted("openBulkContextMenu");
    expect(bulkMenuEvents).toBeTruthy();
    expect(bulkMenuEvents?.[0]?.[0]).toMatchObject({ clientX: 10, clientY: 20 });
  });
});
