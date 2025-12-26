// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import QueueBatchCompressIconBatchItem from "@/components/QueueBatchCompressIconBatchItem.vue";
import en from "@/locales/en";
import type { CompositeBatchCompressTask, TranscodeJob } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

const createMockJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
  id,
  filename: `C:/videos/input-${id}.mp4`,
  type: "video",
  source: "batch_compress",
  originalSizeMB: 100,
  originalCodec: "h264",
  presetId: "p1",
  status,
  progress: status === "processing" ? 50 : 0,
  logs: [],
  batchId: "batch-1",
  previewPath: `/preview/${id}.jpg`,
});

const createMockBatch = (jobs: TranscodeJob[]): CompositeBatchCompressTask => ({
  batchId: "batch-1",
  rootPath: "C:/videos",
  jobs,
  totalFilesScanned: 10,
  totalCandidates: jobs.length,
  totalProcessed: jobs.filter((j) => j.status === "completed").length,
  startedAtMs: undefined,
  completedAtMs: undefined,
  overallProgress: 50,
  currentJob: null,
  completedCount: jobs.filter((j) => j.status === "completed").length,
  skippedCount: jobs.filter((j) => j.status === "skipped").length,
  failedCount: jobs.filter((j) => j.status === "failed").length,
  cancelledCount: jobs.filter((j) => j.status === "cancelled").length,
  totalCount: jobs.length,
});

describe("QueueBatchCompressIconBatchItem", () => {
  describe("选中功能", () => {
    it("canSelect 为 true 时应该显示选中指示器", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: true,
          selected: false,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      // 应该有选中指示器（圆形复选框）
      const selectIndicator = wrapper.find(".rounded-full.border-2");
      expect(selectIndicator.exists()).toBe(true);
    });

    it("canSelect 为 false 时应该显示进度标签而不是选中指示器", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: false,
          selected: false,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      // 应该显示进度标签
      const progressLabel = wrapper.find(".font-mono");
      expect(progressLabel.exists()).toBe(true);
      expect(progressLabel.text()).toContain("50%");
    });

    it("选中状态应该有正确的视觉样式", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: true,
          selected: true,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      // 根元素应该有选中样式
      const root = wrapper.find('[data-testid="queue-icon-batch-item"]');
      expect(root.classes()).toContain("border-amber-500/70");

      // 选中指示器应该有勾选图标
      const checkIcon = wrapper.find("svg");
      expect(checkIcon.exists()).toBe(true);
    });

    it("点击卡片时如果 canSelect 为 true 应该触发 toggle-select 事件", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: true,
          selected: false,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const root = wrapper.find('[data-testid="queue-icon-batch-item"]');
      await root.trigger("click");

      const emitted = wrapper.emitted("toggle-select");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual(["batch-1"]);
    });

    it("点击卡片时如果 canSelect 为 false 应该触发 open-detail 事件", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: false,
          selected: false,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const root = wrapper.find('[data-testid="queue-icon-batch-item"]');
      await root.trigger("click");

      const emitted = wrapper.emitted("open-detail");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0][0]).toMatchObject({ batchId: "batch-1" });
    });
  });

  describe("右键菜单", () => {
    it("右键点击应该触发 contextmenu-batch 事件", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: true,
          selected: false,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const root = wrapper.find('[data-testid="queue-icon-batch-item"]');
      await root.trigger("contextmenu");

      const emitted = wrapper.emitted("contextmenu-batch");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0][0]).toMatchObject({
        batch: expect.objectContaining({ batchId: "batch-1" }),
      });
    });
  });

  describe("进度条颜色", () => {
    it("全部任务完成时进度条应该显示绿色（与普通任务一致）", async () => {
      const jobs = [createMockJob("job-1", "completed"), createMockJob("job-2", "completed")];
      const batch = createMockBatch(jobs);
      // 设置100%进度和正确的完成计数
      batch.overallProgress = 100;
      batch.completedCount = 2;
      batch.totalCount = 2;

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const progressBar = wrapper.find('[data-testid="queue-icon-batch-progress-bar"]');
      expect(progressBar.exists()).toBe(true);
      // 验证使用完整的绿色而不是透明度版本
      expect(progressBar.classes()).toContain("bg-emerald-500");
      expect(progressBar.classes()).not.toContain("bg-emerald-500/40");
    });

    it("有失败任务时进度条应该显示红色", async () => {
      const jobs = [createMockJob("job-1", "completed"), createMockJob("job-2", "failed")];
      const batch = createMockBatch(jobs);
      batch.overallProgress = 50;
      batch.completedCount = 1;
      batch.failedCount = 1;
      batch.totalCount = 2;

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const progressBar = wrapper.find('[data-testid="queue-icon-batch-progress-bar"]');
      expect(progressBar.exists()).toBe(true);
      expect(progressBar.classes()).toContain("bg-red-500/40");
    });

    it("有暂停任务时进度条应该显示黄色", async () => {
      const jobs = [createMockJob("job-1", "completed"), createMockJob("job-2", "paused")];
      const batch = createMockBatch(jobs);
      batch.overallProgress = 50;
      batch.completedCount = 1;
      batch.totalCount = 2;

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const progressBar = wrapper.find('[data-testid="queue-icon-batch-progress-bar"]');
      expect(progressBar.exists()).toBe(true);
      expect(progressBar.classes()).toContain("bg-amber-500/40");
    });

    it("处理中任务时进度条应该显示默认蓝色", async () => {
      const jobs = [createMockJob("job-1", "completed"), createMockJob("job-2", "processing")];
      const batch = createMockBatch(jobs);
      batch.overallProgress = 75;
      batch.completedCount = 1;
      batch.totalCount = 2;

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const progressBar = wrapper.find('[data-testid="queue-icon-batch-progress-bar"]');
      expect(progressBar.exists()).toBe(true);
      expect(progressBar.classes()).toContain("bg-primary/40");
    });
  });

  describe("9宫格预览", () => {
    it("应该渲染9个预览槽位", async () => {
      const jobs = Array.from({ length: 5 }, (_, i) => createMockJob(`job-${i}`, "queued"));
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      // 检查9宫格容器
      const grid = wrapper.find(".grid.grid-cols-3.grid-rows-3");
      expect(grid.exists()).toBe(true);

      // 应该有9个直接子槽位（使用 :scope > div 选择直接子元素）
      const slots = grid.findAll(":scope > div");
      expect(slots.length).toBe(9);
    });

    it("在可选中模式下点击9宫格预览应该弹出详情而不是选中", async () => {
      const jobs = Array.from({ length: 3 }, (_, i) => createMockJob(`job-${i}`, "queued"));
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
          canSelect: true,
          selected: false,
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const grid = wrapper.find(".grid.grid-cols-3.grid-rows-3");
      expect(grid.exists()).toBe(true);

      await grid.trigger("click");

      const openDetail = wrapper.emitted("open-detail");
      expect(openDetail).toBeTruthy();
      expect(openDetail?.[0][0]).toMatchObject({ batchId: "batch-1" });

      const toggleSelect = wrapper.emitted("toggle-select");
      expect(toggleSelect).toBeUndefined();
    });

    it("当部分子任务缺失预览时，九宫格中不应重复展示同一子任务的缩略图", async () => {
      // 构造一个批次：只有部分子任务带有 previewPath，其余子任务没有预览。
      // 之前的实现会因为同时使用 withPreview[index] 和 jobs[index] 导致同一个
      // job 出现在多个槽位中，从而九宫格内出现重复缩略图。
      const jobs: TranscodeJob[] = [
        createMockJob("job-1", "queued"), // 有预览
        { ...createMockJob("job-2", "queued"), previewPath: undefined },
        { ...createMockJob("job-3", "queued"), previewPath: undefined },
        createMockJob("job-4", "queued"), // 有预览
        { ...createMockJob("job-5", "queued"), previewPath: undefined },
        createMockJob("job-6", "queued"), // 有预览
      ];
      const batch = createMockBatch(jobs);

      const wrapper = mount(QueueBatchCompressIconBatchItem, {
        props: {
          batch,
          size: "medium",
          progressStyle: "bar",
        },
        global: {
          plugins: [i18n],
        },
      });

      await nextTick();

      const grid = wrapper.find(".grid.grid-cols-3.grid-rows-3");
      expect(grid.exists()).toBe(true);

      // 只统计真实图片槽位，确保每个预览只出现一次。
      const imgs = grid.findAll("img");
      const srcs = imgs.map((img) => img.attributes("src"));

      expect(srcs.length).toBeGreaterThan(0);
      expect(new Set(srcs).size).toBe(srcs.length);
    });
  });
});
