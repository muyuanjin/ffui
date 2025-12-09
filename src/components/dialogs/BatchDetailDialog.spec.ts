// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick, defineComponent } from "vue";
import BatchDetailDialog from "@/components/dialogs/BatchDetailDialog.vue";
import en from "@/locales/en";
import type { CompositeSmartScanTask, FFmpegPreset, TranscodeJob } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

// 模拟 QueueItem 组件，用于测试事件传递
const QueueItemStub = defineComponent({
  name: "QueueItem",
  props: [
    "job",
    "preset",
    "canCancel",
    "canWait",
    "canResume",
    "canRestart",
    "viewMode",
    "progressStyle",
    "progressUpdateIntervalMs",
  ],
  emits: [
    "cancel",
    "wait",
    "resume",
    "restart",
    "inspect",
    "preview",
    "contextmenu-job",
  ],
  setup(props, { emit }) {
    const onContextMenu = (event: MouseEvent) => {
      emit("contextmenu-job", { job: props.job, event });
    };
    return { onContextMenu };
  },
  template: `
    <div
      data-testid="queue-item-stub"
      :data-job-id="job.id"
      :data-can-wait="canWait"
      :data-can-resume="canResume"
      :data-can-restart="canRestart"
      :data-can-cancel="canCancel"
      @click="$emit('inspect', job)"
      @contextmenu.prevent="onContextMenu"
    >
      <button data-testid="wait-btn" v-if="canWait" @click.stop="$emit('wait', job.id)">Wait</button>
      <button data-testid="resume-btn" v-if="canResume" @click.stop="$emit('resume', job.id)">Resume</button>
      <button data-testid="restart-btn" v-if="canRestart" @click.stop="$emit('restart', job.id)">Restart</button>
      <button data-testid="cancel-btn" v-if="canCancel" @click.stop="$emit('cancel', job.id)">Cancel</button>
    </div>
  `,
});

// 模拟 QueueContextMenu 组件
const QueueContextMenuStub = defineComponent({
  name: "QueueContextMenu",
  props: [
    "visible",
    "x",
    "y",
    "mode",
    "jobStatus",
    "queueMode",
    "hasSelection",
    "canRevealInputPath",
    "canRevealOutputPath",
  ],
  emits: ["close", "inspect", "wait", "resume", "restart", "cancel"],
  template: `
    <div v-if="visible" data-testid="context-menu-stub" :data-job-status="jobStatus">
      <button data-testid="ctx-wait" @click="$emit('wait')">Wait</button>
      <button data-testid="ctx-resume" @click="$emit('resume')">Resume</button>
      <button data-testid="ctx-restart" @click="$emit('restart')">Restart</button>
      <button data-testid="ctx-cancel" @click="$emit('cancel')">Cancel</button>
      <button data-testid="ctx-inspect" @click="$emit('inspect')">Inspect</button>
      <button data-testid="ctx-close" @click="$emit('close')">Close</button>
    </div>
  `,
});

const createMockPreset = (id: string): FFmpegPreset => ({
  id,
  name: `Preset ${id}`,
  description: "",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
});

const createMockJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
  id,
  filename: `C:/videos/input-${id}.mp4`,
  type: "video",
  source: "smart_scan",
  originalSizeMB: 100,
  originalCodec: "h264",
  presetId: "p1",
  status,
  progress: status === "processing" ? 50 : 0,
  logs: [],
  batchId: "batch-1",
});

const createMockBatch = (jobs: TranscodeJob[]): CompositeSmartScanTask => ({
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

// 创建挂载选项的辅助函数
const createMountOptions = (batch: CompositeSmartScanTask, presets: FFmpegPreset[]) => ({
  props: {
    open: true,
    batch,
    presets,
    progressStyle: "bar" as const,
    progressUpdateIntervalMs: 500,
  },
  global: {
    plugins: [i18n],
    stubs: {
      // 异步组件需要用组件名字符串来 stub
      QueueItem: QueueItemStub,
      QueueContextMenu: QueueContextMenuStub,
      // Dialog 相关组件也需要 stub
      Dialog: {
        template: '<div data-testid="dialog"><slot /></div>',
      },
      DialogContent: {
        template: '<div data-testid="dialog-content" class="flex flex-col"><slot /></div>',
      },
      DialogHeader: {
        template: '<div data-testid="dialog-header"><slot /></div>',
      },
      DialogTitle: {
        template: '<div data-testid="dialog-title"><slot /></div>',
      },
      DialogDescription: {
        template: '<div data-testid="dialog-description"><slot /></div>',
      },
      ScrollArea: {
        template: '<div data-testid="scroll-area" class="flex-1 min-h-0"><slot /></div>',
      },
      Progress: {
        template: '<div data-testid="progress"></div>',
      },
      Badge: {
        template: '<span data-testid="badge"><slot /></span>',
      },
    },
  },
});

describe("BatchDetailDialog", () => {
  const presets = [createMockPreset("p1")];

  describe("滚动功能", () => {
    it("ScrollArea 应该有正确的 flex 布局类以支持滚动", async () => {
      const jobs = Array.from({ length: 20 }, (_, i) =>
        createMockJob(`job-${i}`, "waiting"),
      );
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 检查 ScrollArea 存在
      const scrollArea = wrapper.find('[data-testid="scroll-area"]');
      expect(scrollArea.exists()).toBe(true);

      // 检查内容容器有正确的 flex 布局
      const contentDiv = wrapper.find('.flex.flex-col');
      expect(contentDiv.exists()).toBe(true);
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
      const previewGrid = wrapper.find('.grid.grid-cols-3');
      expect(previewGrid.exists()).toBe(true);

      // 应该有9个槽位
      const slots = previewGrid.findAll('div > div');
      expect(slots.length).toBeGreaterThanOrEqual(9);
    });

    it("点击预览图应该触发 previewJob 事件", async () => {
      const jobs = [{
        ...createMockJob("job-1", "processing"),
        previewPath: "/preview/job-1.jpg",
      }];
      const batch = createMockBatch(jobs);

      const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

      await flushPromises();
      await nextTick();

      // 找到第一个预览槽位并点击
      const previewGrid = wrapper.find('.grid.grid-cols-3');
      const firstSlot = previewGrid.find('div > div');
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
  });
});
