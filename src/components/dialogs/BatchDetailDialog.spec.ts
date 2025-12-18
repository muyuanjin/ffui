// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import BatchDetailDialog from "@/components/dialogs/BatchDetailDialog.vue";
import type { TranscodeJob } from "@/types";
import { createMockPreset, createMockJob, createMockBatch, createMountOptions } from "./BatchDetailDialog.test-utils";

describe("BatchDetailDialog", () => {
  const presets = [createMockPreset("p1")];

  describe("滚动功能", () => {
    it("对话框主体使用单一垂直布局容器承载批次详情内容", async () => {
      const jobs = Array.from({ length: 20 }, (_, i) => createMockJob(`job-${i}`, "waiting"));
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 对话框内容主体容器应存在，并采用垂直 flex 布局
      const body = wrapper.find('[data-testid="batch-detail-body"]');
      expect(body.exists()).toBe(true);
      expect(body.classes()).toContain("flex");
      expect(body.classes()).toContain("flex-col");
    });

    it("批次详情不再嵌套内部 ScrollArea，避免只有子任务列表可以滚动", async () => {
      const jobs = Array.from({ length: 20 }, (_, i) => createMockJob(`job-${i}`, "waiting"));
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 不应再渲染内部 ScrollArea 视口节点，防止“双层滚动”导致整体窗口无法滚动的错觉
      const scrollViewport = wrapper.find("[data-reka-scroll-area-viewport]");
      expect(scrollViewport.exists()).toBe(false);
    });
  });

  describe("子任务操作按钮", () => {
    it("processing 状态的任务应该显示暂停按钮", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      expect(queueItem.exists()).toBe(true);
      expect(queueItem.attributes("data-can-wait")).toBe("true");
    });

    it("paused 状态的任务应该显示继续按钮", async () => {
      const jobs = [createMockJob("job-1", "paused")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      expect(queueItem.exists()).toBe(true);
      expect(queueItem.attributes("data-can-resume")).toBe("true");
    });

    it("waiting 状态的任务应该显示取消和重启按钮", async () => {
      const jobs = [createMockJob("job-1", "waiting")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      expect(queueItem.exists()).toBe(true);
      expect(queueItem.attributes("data-can-cancel")).toBe("true");
      expect(queueItem.attributes("data-can-restart")).toBe("true");
    });

    it("点击暂停按钮应该触发 waitJob 事件", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const waitBtn = wrapper.find('[data-testid="wait-btn"]');
      expect(waitBtn.exists()).toBe(true);
      await waitBtn.trigger("click");

      const emitted = wrapper.emitted("waitJob");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual(["job-1"]);
    });

    it("点击继续按钮应该触发 resumeJob 事件", async () => {
      const jobs = [createMockJob("job-1", "paused")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const resumeBtn = wrapper.find('[data-testid="resume-btn"]');
      expect(resumeBtn.exists()).toBe(true);
      await resumeBtn.trigger("click");

      const emitted = wrapper.emitted("resumeJob");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual(["job-1"]);
    });

    it("点击重启按钮应该触发 restartJob 事件", async () => {
      const jobs = [createMockJob("job-1", "waiting")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const restartBtn = wrapper.find('[data-testid="restart-btn"]');
      expect(restartBtn.exists()).toBe(true);
      await restartBtn.trigger("click");

      const emitted = wrapper.emitted("restartJob");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual(["job-1"]);
    });
  });

  describe("右键菜单", () => {
    it("右键点击子任务应该显示上下文菜单", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 初始状态下菜单不可见
      let contextMenu = wrapper.find('[data-testid="context-menu-stub"]');
      expect(contextMenu.exists()).toBe(false);

      // 触发右键菜单
      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      await queueItem.trigger("contextmenu");
      await nextTick();

      // 菜单应该可见
      contextMenu = wrapper.find('[data-testid="context-menu-stub"]');
      expect(contextMenu.exists()).toBe(true);
      expect(contextMenu.attributes("data-job-status")).toBe("processing");
    });

    it("通过右键菜单暂停任务应该触发 waitJob 事件", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 触发右键菜单
      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      await queueItem.trigger("contextmenu");
      await nextTick();

      // 点击暂停按钮
      const ctxWait = wrapper.find('[data-testid="ctx-wait"]');
      await ctxWait.trigger("click");

      const emitted = wrapper.emitted("waitJob");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]).toEqual(["job-1"]);
    });

    it("关闭右键菜单应该隐藏菜单", async () => {
      const jobs = [createMockJob("job-1", "processing")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 触发右键菜单
      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      await queueItem.trigger("contextmenu");
      await nextTick();

      // 菜单可见
      let contextMenu = wrapper.find('[data-testid="context-menu-stub"]');
      expect(contextMenu.exists()).toBe(true);

      // 关闭菜单
      const closeBtn = wrapper.find('[data-testid="ctx-close"]');
      await closeBtn.trigger("click");
      await nextTick();

      // 菜单应该隐藏
      contextMenu = wrapper.find('[data-testid="context-menu-stub"]');
      expect(contextMenu.exists()).toBe(false);
    });
  });

  describe("completed 状态的任务", () => {
    it("completed 状态的任务不应该显示操作按钮（除了详情）", async () => {
      const jobs = [createMockJob("job-1", "completed")];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const queueItem = wrapper.find('[data-testid="queue-item-stub"]');
      expect(queueItem.exists()).toBe(true);
      expect(queueItem.attributes("data-can-wait")).toBe("false");
      expect(queueItem.attributes("data-can-resume")).toBe("false");
      expect(queueItem.attributes("data-can-restart")).toBe("false");
      expect(queueItem.attributes("data-can-cancel")).toBe("false");
    });
  });

  describe("9宫格预览图", () => {
    it("应该渲染9个预览槽位", async () => {
      const jobs = Array.from({ length: 5 }, (_, i) => ({
        ...createMockJob(`job-${i}`, "waiting"),
        previewPath: `/preview/job-${i}.jpg`,
      }));
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 检查9宫格容器存在
      const previewGrid = wrapper.find(".grid.grid-cols-3");
      expect(previewGrid.exists()).toBe(true);

      // 应该有9个槽位
      const slots = previewGrid.findAll("div > div");
      expect(slots.length).toBeGreaterThanOrEqual(9);
    });

    it("点击预览图应该触发 previewJob 事件", async () => {
      const jobs = [
        {
          ...createMockJob("job-1", "processing"),
          previewPath: "/preview/job-1.jpg",
        },
      ];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 找到第一个预览槽位并点击
      const previewGrid = wrapper.find(".grid.grid-cols-3");
      const firstSlot = previewGrid.find("div > div");
      await firstSlot.trigger("click");

      const emitted = wrapper.emitted("previewJob");
      expect(emitted).toBeTruthy();
      expect(emitted?.[0][0]).toMatchObject({ id: "job-1" });
    });

    it("对于图片子任务在缺失 previewPath 时回退到 outputPath 进行预览", async () => {
      const imageJob: TranscodeJob = {
        ...createMockJob("job-image-1", "completed"),
        type: "image",
        filename: "C:/images/sample.avif",
        inputPath: "C:/images/original.png",
        outputPath: "C:/images/sample.avif",
        previewPath: undefined,
      } as TranscodeJob;

      const batch = createMockBatch([imageJob]);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const previewGrid = wrapper.find(".grid.grid-cols-3");
      expect(previewGrid.exists()).toBe(true);

      const firstImg = previewGrid.find("img");
      expect(firstImg.exists()).toBe(true);
      // 在测试环境中 buildPreviewUrl 会直接返回原始路径，因此应等于 outputPath。
      expect(firstImg.attributes("src")).toBe(imageJob.outputPath);
    });

    it("当部分子任务缺失预览时，九宫格中不应重复展示同一子任务的缩略图", async () => {
      const jobs: TranscodeJob[] = [
        { ...createMockJob("job-1", "completed"), previewPath: "/preview/job-1.jpg" },
        { ...createMockJob("job-2", "completed"), previewPath: undefined },
        { ...createMockJob("job-3", "completed"), previewPath: undefined },
        { ...createMockJob("job-4", "completed"), previewPath: "/preview/job-4.jpg" },
        { ...createMockJob("job-5", "completed"), previewPath: undefined },
        { ...createMockJob("job-6", "completed"), previewPath: "/preview/job-6.jpg" },
      ];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      const previewGrid = wrapper.find(".grid.grid-cols-3");
      expect(previewGrid.exists()).toBe(true);

      const imgs = previewGrid.findAll("img");
      const srcs = imgs.map((img) => img.attributes("src"));

      expect(srcs.length).toBeGreaterThan(0);
      expect(new Set(srcs).size).toBe(srcs.length);
    });
  });
});
