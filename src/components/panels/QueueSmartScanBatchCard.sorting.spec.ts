// @vitest-environment jsdom
/**
 * 测试 QueueSmartScanBatchCard 组件的子任务排序功能
 * 验证当传入 sortCompareFn 时，子任务列表按照排序函数进行排序
 */
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueSmartScanBatchCard from "./QueueSmartScanBatchCard.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, TranscodeJob, CompositeSmartScanTask } from "@/types";

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
  description: "Preset for batch sorting tests",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
};

const createChildJob = (id: string, filename: string, startTime?: number): TranscodeJob =>
  ({
    id,
    filename,
    inputPath: `C:/videos/${filename}`,
    type: "video",
    source: "smart_scan",
    originalSizeMB: 10,
    originalCodec: "h264",
    presetId: basePreset.id,
    status: "waiting",
    progress: 0,
    logs: [],
    batchId: "batch-1",
    startTime: startTime ?? Date.now(),
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

// QueueItem 的 stub，用于捕获渲染顺序
const queueItemStub = {
  props: [
    "job",
    "preset",
    "canCancel",
    "canRestart",
    "canSelect",
    "selected",
    "viewMode",
    "progressStyle",
    "progressUpdateIntervalMs",
  ],
  template: `<div data-testid="queue-item-stub" :data-job-id="job.id" :data-filename="job.filename">{{ job.filename }}</div>`,
};

describe("QueueSmartScanBatchCard 子任务排序", () => {
  const createWrapper = (jobs: TranscodeJob[], sortCompareFn?: (a: TranscodeJob, b: TranscodeJob) => number) => {
    const batch = createBatch(jobs);

    return mount(QueueSmartScanBatchCard, {
      props: {
        batch,
        presets: [basePreset],
        ffmpegResolvedPath: null,
        queueRowVariant: "compact",
        queueProgressStyle: "bar",
        progressUpdateIntervalMs: 500,
        selectedJobIds: new Set<string>(),
        isExpanded: true, // 展开以显示子任务
        canCancelJob: () => true,
        sortCompareFn,
      },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });
  };

  it("不传入 sortCompareFn 时，子任务按原始顺序显示", async () => {
    const jobs = [
      createChildJob("job-c", "charlie.mp4"),
      createChildJob("job-a", "alpha.mp4"),
      createChildJob("job-b", "beta.mp4"),
    ];

    const wrapper = createWrapper(jobs);

    const renderedIds = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));

    // 原始顺序
    expect(renderedIds).toEqual(["job-c", "job-a", "job-b"]);
  });

  it("传入 sortCompareFn 时，子任务按排序函数排序（按文件名升序）", async () => {
    const jobs = [
      createChildJob("job-c", "charlie.mp4"),
      createChildJob("job-a", "alpha.mp4"),
      createChildJob("job-b", "beta.mp4"),
    ];

    // 按文件名升序排序
    const sortByFilenameAsc = (a: TranscodeJob, b: TranscodeJob) => (a.filename || "").localeCompare(b.filename || "");

    const wrapper = createWrapper(jobs, sortByFilenameAsc);

    const renderedIds = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));

    // 按文件名排序后的顺序
    expect(renderedIds).toEqual(["job-a", "job-b", "job-c"]);
  });

  it("传入 sortCompareFn 时，子任务按排序函数排序（按文件名降序）", async () => {
    const jobs = [
      createChildJob("job-a", "alpha.mp4"),
      createChildJob("job-b", "beta.mp4"),
      createChildJob("job-c", "charlie.mp4"),
    ];

    // 按文件名降序排序
    const sortByFilenameDesc = (a: TranscodeJob, b: TranscodeJob) => (b.filename || "").localeCompare(a.filename || "");

    const wrapper = createWrapper(jobs, sortByFilenameDesc);

    const renderedIds = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));

    // 按文件名降序排序后的顺序
    expect(renderedIds).toEqual(["job-c", "job-b", "job-a"]);
  });

  it("传入 sortCompareFn 时，子任务按排序函数排序（按开始时间）", async () => {
    const jobs = [
      createChildJob("job-2", "second.mp4", 2000),
      createChildJob("job-1", "first.mp4", 1000),
      createChildJob("job-3", "third.mp4", 3000),
    ];

    // 按开始时间升序排序（startTime 用于表示添加到队列的时间）
    const sortByStartTimeAsc = (a: TranscodeJob, b: TranscodeJob) => (a.startTime ?? 0) - (b.startTime ?? 0);

    const wrapper = createWrapper(jobs, sortByStartTimeAsc);

    const renderedIds = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));

    // 按开始时间排序后的顺序
    expect(renderedIds).toEqual(["job-1", "job-2", "job-3"]);
  });

  it("排序不影响 skipped 状态的任务（它们被过滤掉）", async () => {
    const jobs = [
      createChildJob("job-c", "charlie.mp4"),
      { ...createChildJob("job-skipped", "skipped.mp4"), status: "skipped" } as TranscodeJob,
      createChildJob("job-a", "alpha.mp4"),
    ];

    const sortByFilenameAsc = (a: TranscodeJob, b: TranscodeJob) => (a.filename || "").localeCompare(b.filename || "");

    const wrapper = createWrapper(jobs, sortByFilenameAsc);

    const renderedIds = wrapper.findAll("[data-testid='queue-item-stub']").map((el) => el.attributes("data-job-id"));

    // skipped 任务被过滤，剩余任务按文件名排序
    expect(renderedIds).toEqual(["job-a", "job-c"]);
    expect(renderedIds).not.toContain("job-skipped");
  });
});
