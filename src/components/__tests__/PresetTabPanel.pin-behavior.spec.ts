// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PresetTabPanel from "@/components/panels/PresetTabPanel.vue";
import type { FFmpegPreset } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";

const makePreset = (id: string, name: string): FFmpegPreset => ({
  id,
  name,
  description: name,
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("PresetTabPanel pin behaviour", () => {
  it("does not force secondary header visible when unpinned", async () => {
    const setPresetSelectionBarPinned = vi.fn<(pinned: boolean) => void>();

    const wrapper = mount(PresetTabPanel, {
      props: {
        presets: [makePreset("p1", "One")],
        presetSortMode: "manual",
        presetSortDirection: "desc",
        presetViewMode: "grid",
        presetSelectionBarPinned: false,
        presetCardFooter: null,
        vmafMeasureReferencePath: "",
        setVmafMeasureReferencePath: vi.fn(),
        ensureAppSettingsLoaded: vi.fn(async () => {}),
        setPresetSelectionBarPinned,
        setPresetSortMode: vi.fn(),
        setPresetSortDirection: vi.fn(),
        setPresetViewMode: vi.fn(),
        dialogManager: {
          openSmartPresetImport: vi.fn(),
          openImportCommands: vi.fn(),
        } as any,
        presetsModule: {
          openPresetEditor: vi.fn(),
          duplicatePreset: vi.fn(),
          requestDeletePreset: vi.fn(),
          requestBatchDeletePresets: vi.fn(),
          exportSelectedPresetsBundleToFile: vi.fn(),
          exportSelectedPresetsBundleToClipboard: vi.fn(),
          exportSelectedPresetsTemplateCommandsToClipboard: vi.fn(),
          exportPresetToFile: vi.fn(),
          handleReorderPresets: vi.fn(),
          importPresetsBundleFromFile: vi.fn(),
          importPresetsBundleFromClipboard: vi.fn(),
          reloadPresets: vi.fn(),
        } as any,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find('[data-testid="preset-vmaf-measure-open"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="preset-selection-actions"]').exists()).toBe(false);

    await wrapper.get('[data-testid="preset-select-toggle"]').trigger("click");
    expect(wrapper.find('[data-testid="preset-selection-actions"]').exists()).toBe(true);

    await wrapper.get('[data-testid="preset-selection-pin"]').trigger("click");
    expect(setPresetSelectionBarPinned).toHaveBeenCalledWith(true);

    wrapper.unmount();
  });
});
