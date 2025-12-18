// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueuePanel from "./QueuePanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob } from "@/types";
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
    "canWait",
    "canResume",
    "canRestart",
    "canSelect",
    "selected",
    "viewMode",
    "progressStyle",
    "progressUpdateIntervalMs",
  ],
  template: `
    <div data-testid="queue-item-stub">
      <button
        v-if="canResume"
        type="button"
        data-testid="queue-panel-resume-button"
        @click="$emit('resume', job.id)"
      >
        Resume
      </button>
    </div>
  `,
};

const queueIconItemStub = {
  props: ["job", "size", "progressStyle"],
  template: `<div data-testid="queue-icon-item-stub">{{ job.filename }}</div>`,
};

const queueSmartScanIconBatchStub = {
  props: ["batch", "size", "progressStyle"],
  template: `<div data-testid="queue-icon-batch-stub">{{ batch.batchId }}</div>`,
};

function makeJob(): TranscodeJob {
  return {
    id: "job-1",
    filename: "C:/videos/display-mode-resume.mp4",
    type: "video",
    source: "manual",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: "preset-1",
    status: "paused",
    progress: 40,
    logs: [],
  } as TranscodeJob;
}

const basePreset: FFmpegPreset = {
  id: "preset-1",
  name: "Test Preset",
  description: "Preset used in QueuePanel tests",
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

describe("QueuePanel display mode actions", () => {
  it("emits resumeJob when a display-mode job card emits resume", async () => {
    const job = makeJob();
    const items: QueueListItem[] = [{ kind: "job", job }];

    const wrapper = mount(QueuePanel, {
      props: {
        queueJobsForDisplay: [job],
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
        queueMode: "display",
        isIconViewMode: false,
        isCarousel3dViewMode: false,
        carouselAutoRotationSpeed: 0,
        iconViewSize: "small",
        iconGridClass: "",
        queueRowVariant: "detail",
        progressUpdateIntervalMs: 500,
        hasSmartScanBatches: false,

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

        expandedBatchIds: new Set<string>(),
        queueError: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
          QueueIconItem: queueIconItemStub,
          QueueSmartScanIconBatchItem: queueSmartScanIconBatchStub,
        },
      },
    });

    const resumeButton = wrapper.get("[data-testid='queue-panel-resume-button']");
    await resumeButton.trigger("click");

    const emitted = wrapper.emitted("resumeJob");
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]).toEqual([job.id]);
  });
});
