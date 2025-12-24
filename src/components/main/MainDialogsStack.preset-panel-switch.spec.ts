// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import MainDialogsStack from "./MainDialogsStack.vue";
import { useDialogManager } from "@/composables/useDialogManager";
import type { FFmpegPreset, QueueProgressStyle } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";
import { DEFAULT_BATCH_COMPRESS_CONFIG } from "@/constants";

const StubParameterWizard = defineComponent({
  name: "ParameterWizard",
  emits: ["switchToPanel"],
  data() {
    const preset: FFmpegPreset = {
      id: "new-preset-1",
      name: "New Preset",
      description: "",
      global: { hideBanner: true },
      video: {
        encoder: "libx264",
        rateControl: "crf",
        qualityValue: 23,
        preset: "medium",
        tune: "film",
      } as any,
      audio: { codec: "copy", bitrate: 192 } as any,
      filters: {},
      advancedEnabled: false,
      ffmpegTemplate: undefined,
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    };
    return { preset };
  },
  template: `<button data-testid="stub-wizard-switch-to-panel" @click="$emit('switchToPanel', preset)">switch</button>`,
});

const StubUltimateParameterPanel = defineComponent({
  name: "UltimateParameterPanel",
  props: {
    initialPreset: {
      type: Object,
      required: true,
    },
  },
  emits: ["switchToWizard"],
  template: `<button data-testid="stub-panel-switch-to-wizard" @click="$emit('switchToWizard', initialPreset)">back</button>`,
});

const createWrapper = (dialogManager: ReturnType<typeof useDialogManager>) => {
  const presets: FFmpegPreset[] = [];
  const queueProgressStyle: QueueProgressStyle = "bar";

  return mount(MainDialogsStack, {
    props: {
      dialogManager,
      presets,
      presetPendingDelete: null,
      smartConfig: { ...DEFAULT_BATCH_COMPRESS_CONFIG },
      defaultVideoPresetId: null,
      queueProgressStyle,
      progressUpdateIntervalMs: 500,
      selectedJobPreset: null,
      jobDetailLogText: "",
      highlightedLogHtml: "",
      previewUrl: null,
      previewPath: null,
      previewSourceMode: "output",
      previewIsImage: false,
      previewError: null,
      ffmpegResolvedPath: null,
    },
    global: {
      plugins: [i18n],
      stubs: {
        ParameterWizard: StubParameterWizard,
        UltimateParameterPanel: StubUltimateParameterPanel,
        BatchCompressWizard: true,
        DeletePresetDialog: true,
        JobDetailDialog: true,
        BatchDetailDialog: true,
        ExpandedPreviewDialog: true,
        JobCompareDialog: true,
        SmartPresetOnboardingWizard: true,
      },
    },
  });
};

describe("MainDialogsStack 预设向导与完整参数面板切换", () => {
  it("新建预设时点击“打开完整参数面板”应关闭向导并打开面板", async () => {
    const dialogManager = useDialogManager();
    dialogManager.openWizard();

    const wrapper = createWrapper(dialogManager);

    expect(dialogManager.wizardOpen.value).toBe(true);
    expect(dialogManager.parameterPanelOpen.value).toBe(false);
    expect(dialogManager.editingPreset.value).toBeNull();

    await wrapper.find("[data-testid='stub-wizard-switch-to-panel']").trigger("click");
    await nextTick();

    expect(dialogManager.wizardOpen.value).toBe(false);
    expect(dialogManager.parameterPanelOpen.value).toBe(true);
    expect(dialogManager.editingPreset.value?.id).toBe("new-preset-1");
  });

  it("完整参数面板点击“返回向导”应关闭面板并回到向导", async () => {
    const dialogManager = useDialogManager();
    const preset: FFmpegPreset = {
      id: "preset-1",
      name: "Preset 1",
      description: "",
      global: { hideBanner: true },
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium", tune: "film" } as any,
      audio: { codec: "copy", bitrate: 192 } as any,
      filters: {},
      advancedEnabled: false,
      ffmpegTemplate: undefined,
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
    };

    dialogManager.openParameterPanel(preset);
    const wrapper = createWrapper(dialogManager);

    expect(dialogManager.parameterPanelOpen.value).toBe(true);
    expect(dialogManager.wizardOpen.value).toBe(false);

    await wrapper.find("[data-testid='stub-panel-switch-to-wizard']").trigger("click");
    await nextTick();

    expect(dialogManager.parameterPanelOpen.value).toBe(false);
    expect(dialogManager.wizardOpen.value).toBe(true);
    expect(dialogManager.editingPreset.value?.id).toBe("preset-1");
  });
});
