// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PresetVmafMeasureDialog from "@/components/dialogs/PresetVmafMeasureDialog.vue";
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

describe("PresetVmafMeasureDialog", () => {
  it("renders VMAF dataset links as clickable anchors with selectable URLs", async () => {
    const presets = [makePreset("p1", "One")];
    const wrapper = mount(PresetVmafMeasureDialog, {
      props: {
        open: true,
        presets,
        reloadPresets: async () => {},
        vmafMeasureReferencePath: "",
        setVmafMeasureReferencePath: () => {},
        ensureAppSettingsLoaded: async () => {},
      },
      global: { plugins: [i18n] },
    });

    await wrapper.get('[data-testid="preset-vmaf-measure-about-toggle"]').trigger("click");
    await wrapper.vm.$nextTick();

    const ids = ["vmaf", "vmaf-datasets", "avt-vqdb-hdr", "avt-vqdb-appeal"] as const;
    for (const id of ids) {
      const a = wrapper.get(`[data-testid="preset-vmaf-link-${id}"]`);
      expect(a.element.tagName.toLowerCase()).toBe("a");
      expect(a.attributes("href")).toMatch(/^https?:\/\//);
      expect(a.attributes("target")).toBe("_blank");

      const url = wrapper.get(`[data-testid="preset-vmaf-link-url-${id}"]`).text();
      expect(url).toMatch(/^https?:\/\//);
    }

    wrapper.unmount();
  });
});
