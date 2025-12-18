// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "./QueuePanel.vue";
import QueueBatchCompressBatchCard from "./QueueBatchCompressBatchCard.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob, CompositeBatchCompressTask } from "@/types";
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

const queueItemStub = {
  props: [
    "job",
    "preset",
    "canCancel",
    "canSelect",
    "selected",
    "viewMode",
    "progressStyle",
    "progressUpdateIntervalMs",
  ],
  emits: ["toggle-select", "contextmenu-job"],
  template: `
    <div
      data-testid="queue-item-stub"
      :data-job-id="job.id"
      :data-can-select="String(!!canSelect)"
      :data-selected="String(!!selected)"
      @click="$emit('toggle-select', job.id)"
      @contextmenu.prevent="$emit('contextmenu-job', { job, event: $event })"
    />
  `,
};

const queueIconItemStub = {
  props: ["job", "size", "progressStyle"],
  template: `<div data-testid="queue-icon-item-stub">{{ job.filename }}</div>`,
};

const queueBatchCompressIconBatchStub = {
  props: ["batch", "size", "progressStyle"],
  template: `<div data-testid="queue-icon-batch-stub">{{ batch.batchId }}</div>`,
};

const checkboxStub = {
  emits: ["update:checked"],
  template: `<div data-testid="batch-checkbox" @click="$emit('update:checked', true)"></div>`,
};

const basePreset: FFmpegPreset = {
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used in QueuePanel Batch Compress children tests",
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

describe("QueuePanel Batch Compress batch children interactions", () => {
  it("允许在队列模式下对复合任务展开的子任务进行单独选中和右键", async () => {
    const childJob: TranscodeJob = {
      id: "job-child-1",
      filename: "C:/videos/child-1.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: basePreset.id,
      status: "waiting",
      progress: 0,
      logs: [],
      batchId: "batch-1",
    } as TranscodeJob;

    const batch: CompositeBatchCompressTask = {
      batchId: "batch-1",
      rootPath: "C:/videos",
      jobs: [childJob],
      totalFilesScanned: 1,
      totalCandidates: 1,
      totalProcessed: 0,
      startedAtMs: Date.now(),
      completedAtMs: undefined,
      overallProgress: 0,
      currentJob: null,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      totalCount: 1,
    };

    const items: QueueListItem[] = [{ kind: "batch", batch }];

    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [childJob],
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        pausingJobIds: new Set<string>(),
        presets: [basePreset],

        queueViewMode: "detail",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "queue",
        isIconViewMode: false,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: "",
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 500,
        hasBatchCompressBatches: true,

        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        hasSelection: false,
        hasActiveFilters: false,
        selectedJobIds: new Set<string>(),
        selectedCount: 0,

        expandedBatchIds: new Set<string>([batch.batchId]),
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: queueIconItemStub,
          QueueBatchCompressIconBatchItem: queueBatchCompressIconBatchStub,
          Checkbox: checkboxStub,
        },
      },
    });

    const childrenContainer = wrapper.get("[data-testid='batch-compress-batch-children']");
    const childItem = childrenContainer.get("[data-testid='queue-item-stub']");

    expect(childItem.attributes("data-job-id")).toBe(childJob.id);
    expect(childItem.attributes("data-can-select")).toBe("true");
    expect(childItem.attributes("data-selected")).toBe("false");

    await childItem.trigger("click");

    const toggleEvents = wrapper.emitted("toggleJobSelected");
    expect(toggleEvents).toBeTruthy();
    expect(toggleEvents?.[0]).toEqual([childJob.id]);

    await childItem.trigger("contextmenu", { clientX: 10, clientY: 20 });

    const contextEvents = wrapper.emitted("openJobContextMenu");
    expect(contextEvents).toBeTruthy();
    const payload = contextEvents?.[0]?.[0] as { job: TranscodeJob };
    expect(payload.job.id).toBe(childJob.id);
  });

  it("允许在队列模式下整体右键复合任务卡片以对该批次子任务执行批量操作", async () => {
    const childJob: TranscodeJob = {
      id: "job-child-1",
      filename: "C:/videos/child-1.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: basePreset.id,
      status: "waiting",
      progress: 0,
      logs: [],
      batchId: "batch-1",
    } as TranscodeJob;

    const batch: CompositeBatchCompressTask = {
      batchId: "batch-1",
      rootPath: "C:/videos",
      jobs: [childJob],
      totalFilesScanned: 1,
      totalCandidates: 1,
      totalProcessed: 0,
      startedAtMs: Date.now(),
      completedAtMs: undefined,
      overallProgress: 0,
      currentJob: null,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      totalCount: 1,
    };

    const items: QueueListItem[] = [{ kind: "batch", batch }];

    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [childJob],
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        pausingJobIds: new Set<string>(),
        presets: [basePreset],

        queueViewMode: "detail",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "queue",
        isIconViewMode: false,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: "",
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 500,
        hasBatchCompressBatches: true,

        activeStatusFilters: new Set<QueueFilterStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "addedTime",
        sortPrimaryDirection: "desc",
        hasSelection: true,
        hasActiveFilters: false,
        // 初始包含其它选中任务，验证 clearSelection 会被触发
        selectedJobIds: new Set<string>(["other-job"]),
        selectedCount: 1,

        expandedBatchIds: new Set<string>([batch.batchId]),
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: queueIconItemStub,
          QueueBatchCompressIconBatchItem: queueBatchCompressIconBatchStub,
        },
      },
    });

    const batchCard = wrapper.get("[data-testid='batch-compress-batch-card']");
    await batchCard.trigger("contextmenu", { clientX: 15, clientY: 25 });

    const clearEvents = wrapper.emitted("clearSelection");
    expect(clearEvents).toBeTruthy();
    expect(clearEvents?.length).toBe(1);

    const toggleEvents = wrapper.emitted("toggleJobSelected") ?? [];
    const toggledIds = toggleEvents.map((e) => e[0]);
    expect(toggledIds).toContain(childJob.id);

    const bulkEvents = wrapper.emitted("openBulkContextMenu");
    expect(bulkEvents).toBeTruthy();
    expect(bulkEvents?.[0]?.[0]).toMatchObject({ clientX: 15, clientY: 25 });
  });

  it("列表视图的批次复选框支持全选与全不选", async () => {
    const childJob1: TranscodeJob = {
      id: "job-child-1",
      filename: "C:/videos/child-1.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: basePreset.id,
      status: "waiting",
      progress: 0,
      logs: [],
      batchId: "batch-1",
    } as TranscodeJob;

    const childJob2: TranscodeJob = {
      id: "job-child-2",
      filename: "C:/videos/child-2.mp4",
      type: "video",
      source: "batch_compress",
      originalSizeMB: 12,
      originalCodec: "h264",
      presetId: basePreset.id,
      status: "completed",
      progress: 100,
      logs: [],
      batchId: "batch-1",
    } as TranscodeJob;

    const batch: CompositeBatchCompressTask = {
      batchId: "batch-1",
      rootPath: "C:/videos",
      jobs: [childJob1, childJob2],
      totalFilesScanned: 2,
      totalCandidates: 2,
      totalProcessed: 1,
      startedAtMs: Date.now(),
      completedAtMs: undefined,
      overallProgress: 50,
      currentJob: null,
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      totalCount: 2,
    };

    const wrapper = mount(QueueBatchCompressBatchCard, {
      props: {
        batch,
        presets: [basePreset],
        ffmpegResolvedPath: null,
        queueRowVariant: "detail",
        queueProgressStyle: "bar",
        progressUpdateIntervalMs: 500,
        selectedJobIds: new Set<string>(),
        isExpanded: true,
        canCancelJob: () => false,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          Checkbox: checkboxStub,
        },
      },
    });

    const checkbox = wrapper.get("[data-testid='batch-checkbox']");
    await checkbox.trigger("click");

    const togglesAfterSelect = wrapper.emitted("toggleJobSelected") ?? [];
    const toggledIds = togglesAfterSelect.map((e) => e[0]);
    expect(new Set(toggledIds)).toEqual(new Set([childJob1.id, childJob2.id]));

    await wrapper.setProps({ selectedJobIds: new Set<string>([childJob1.id, childJob2.id]) });
    await checkbox.trigger("click");

    const togglesAfterUnselect = wrapper.emitted("toggleJobSelected") ?? [];
    const lastTwo = togglesAfterUnselect.slice(-2).map((e) => e[0]);
    expect(new Set(lastTwo)).toEqual(new Set([childJob1.id, childJob2.id]));
  });
});
