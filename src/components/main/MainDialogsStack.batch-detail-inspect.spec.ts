// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MainDialogsStack from "./MainDialogsStack.vue";
import { useDialogManager } from "@/composables/useDialogManager";
import type { FFmpegPreset, QueueProgressStyle, TranscodeJob } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";

describe("MainDialogsStack 批次详情与子任务交互", () => {
  /**
   * 创建带有真实对话框管理器的 MainDialogsStack 包装器。
   * 通过 stub 掉内部对话框组件，专注于事件转发逻辑。
   */
  const createWrapper = () => {
    const dialogManager = useDialogManager();

    const presets: FFmpegPreset[] = [];
    const queueProgressStyle: QueueProgressStyle = "bar";

    const wrapper = mount(MainDialogsStack, {
      props: {
        dialogManager,
        presets,
        presetPendingDelete: null,
        smartConfig: {},
        defaultVideoPresetId: null,
        queueProgressStyle,
        progressUpdateIntervalMs: 500,
        selectedJobPreset: null,
        jobDetailLogText: "",
        highlightedLogHtml: "",
        previewUrl: null,
        previewIsImage: false,
        previewError: null,
        ffmpegResolvedPath: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          ParameterWizard: true,
          UltimateParameterPanel: true,
          SmartScanWizard: true,
          DeletePresetDialog: true,
          JobDetailDialog: true,
          ExpandedPreviewDialog: true,
          SmartPresetOnboardingWizard: true,
          // 使用一个简单的 stub 保留 BatchDetailDialog 的事件接口
          BatchDetailDialog: {
            name: "BatchDetailDialog",
            template: "<div />",
          },
        },
      },
    });

    return { wrapper, dialogManager };
  };

  it("子任务 inspect 事件应打开任务详情而不是预览", async () => {
    const { wrapper, dialogManager } = createWrapper();

    const job: TranscodeJob = {
      id: "job-1",
      filename: "C:/videos/sample.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
    } as any;

    expect(dialogManager.jobDetailOpen.value).toBe(false);

    const batchDialog = wrapper.findComponent({ name: "BatchDetailDialog" });
    expect(batchDialog.exists()).toBe(true);

    // 模拟批次详情对话框内子任务触发“查看详情”事件
    batchDialog.vm.$emit("inspectJob", job);
    await nextTick();

    // 应打开任务详情对话框，并选中对应子任务
    expect(dialogManager.jobDetailOpen.value).toBe(true);
    expect(dialogManager.selectedJob.value).toEqual(job);

    // 不应误触发预览事件
    expect(wrapper.emitted("openJobPreviewFromQueue")).toBeFalsy();
  });

  it("子任务 preview 事件仍应打开预览对话框", async () => {
    const { wrapper } = createWrapper();

    const job: TranscodeJob = {
      id: "job-2",
      filename: "C:/videos/sample-preview.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "preset-1",
      status: "completed",
      progress: 100,
      logs: [],
    } as any;

    const batchDialog = wrapper.findComponent({ name: "BatchDetailDialog" });
    expect(batchDialog.exists()).toBe(true);

    // 模拟批次详情对话框内子任务触发预览事件
    batchDialog.vm.$emit("previewJob", job);
    await nextTick();

    // 应通过事件向上传递，交由上层逻辑打开预览对话框
    const previewEvents = wrapper.emitted("openJobPreviewFromQueue");
    expect(previewEvents).toBeTruthy();
    expect(previewEvents?.[0]?.[0]).toEqual(job);
  });
});
