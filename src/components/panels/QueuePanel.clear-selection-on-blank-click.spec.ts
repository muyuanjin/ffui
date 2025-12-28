// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "./QueuePanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob, JobStatus } from "@/types";
import type { QueueListItem, QueueFilterKind } from "@/composables";

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
  description: "Preset used in QueuePanel clear selection tests",
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

const createJob = (id: string): TranscodeJob =>
  ({
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: basePreset.id,
    status: "queued",
    progress: 0,
    logs: [],
  }) as TranscodeJob;

const queueIconItemStub = {
  props: ["job", "size", "progressStyle", "canSelect", "selected"],
  emits: ["toggle-select"],
  template: `
    <div
      data-testid="queue-icon-item"
      :data-job-id="job.id"
      :data-selected="String(!!selected)"
      @click="$emit('toggle-select', job.id)"
    />
  `,
};

describe.skip("QueuePanel clears selection on blank click", () => {
  const createWrapper = (selectedJobIds: Set<string>) => {
    const job = createJob("job-1");
    const items: QueueListItem[] = [{ kind: "job", job }];

    return mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [job],
        visibleQueueItems: items,
        iconViewItems: items,
        queueModeProcessingJobs: [],
        queueModeWaitingItems: [],
        queueModeWaitingBatchIds: new Set<string>(),
        presets: [basePreset],

        queueViewMode: "icon-small",
        ffmpegResolvedPath: null,
        queueProgressStyle: "bar",
        queueMode: "queue",
        isIconViewMode: true,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: "grid grid-cols-2 gap-2",
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 200,
        hasBatchCompressBatches: false,

        activeStatusFilters: new Set<JobStatus>(),
        activeTypeFilters: new Set<QueueFilterKind>(),
        filterText: "",
        filterUseRegex: false,
        filterRegexError: null,
        sortPrimary: "status",
        sortPrimaryDirection: "asc",
        hasSelection: selectedJobIds.size > 0,
        hasActiveFilters: false,
        selectedJobIds,
        selectedCount: selectedJobIds.size,

        expandedBatchIds: new Set<string>(),
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueIconItem: queueIconItemStub,
          QueueBatchCompressIconBatchItem: true,
          QueueCarousel3DView: true,
          VList: true,
        },
      },
    });
  };

  it("emits clearSelection when clicking blank area", async () => {
    const wrapper = createWrapper(new Set(["job-1"]));
    await wrapper.get("[data-testid='queue-icon-grid']").trigger("click");
    expect(wrapper.emitted("clearSelection")?.length ?? 0).toBe(1);
  });

  it("does not emit clearSelection when clicking a queue item", async () => {
    const wrapper = createWrapper(new Set(["job-1"]));
    await wrapper.get("[data-testid='queue-icon-item']").trigger("click");
    expect(wrapper.emitted("clearSelection")?.length ?? 0).toBe(0);
  });
});
