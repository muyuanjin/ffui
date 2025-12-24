import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import en from "@/locales/en";
import type { CompositeBatchCompressTask, FFmpegPreset, TranscodeJob } from "@/types";

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

// 模拟 QueueItem 组件，用于测试事件传递
export const QueueItemStub = defineComponent({
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
  emits: ["cancel", "wait", "resume", "restart", "inspect", "preview", "contextmenu-job"],
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
export const QueueContextMenuStub = defineComponent({
  name: "QueueContextMenu",
  props: [
    "visible",
    "x",
    "y",
    "mode",
    "teleportToBody",
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

export const createMockPreset = (id: string): FFmpegPreset => ({
  id,
  name: `Preset ${id}`,
  description: "",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
});

export const createMockJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
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
});

export const createMockBatch = (jobs: TranscodeJob[]): CompositeBatchCompressTask => ({
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
export const createMountOptions = (batch: CompositeBatchCompressTask, presets: FFmpegPreset[]) => ({
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
      Progress: {
        template: '<div data-testid="progress"></div>',
      },
      Badge: {
        template: '<span data-testid="badge"><slot /></span>',
      },
    },
  },
});
