// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PresetPanel from "@/components/panels/PresetPanel.vue";
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

describe("PresetPanel library actions", () => {
  it("toggles selection and emits batch actions", async () => {
    const presets = [makePreset("p1", "One"), makePreset("p2", "Two")];
    const wrapper = mount(PresetPanel, {
      props: {
        presets,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find('[data-testid="preset-selection-actions"]').exists()).toBe(false);

    const toggles = wrapper.findAll('[data-testid="preset-select-toggle"]');
    expect(toggles.length).toBeGreaterThanOrEqual(2);
    await toggles[0].trigger("click");

    expect(wrapper.find('[data-testid="preset-selection-actions"]').exists()).toBe(true);

    await wrapper.get('[data-testid="preset-batch-delete"]').trigger("click");
    const batchDeleteEmitted = wrapper.emitted("batchDelete") as unknown[][] | undefined;
    expect(batchDeleteEmitted?.[0]?.[0]).toEqual(["p1"]);

    await wrapper.get('[data-testid="preset-batch-export"]').trigger("click");
    const batchExportEmitted = wrapper.emitted("exportSelectedToFile") as unknown[][] | undefined;
    expect(batchExportEmitted?.[0]?.[0]).toEqual(["p1"]);

    wrapper.unmount();
  });

  it("toggles selection when clicking on the card (non-interactive area)", async () => {
    const presets = [makePreset("p1", "One")];
    const wrapper = mount(PresetPanel, {
      props: {
        presets,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.find('[data-testid="preset-selection-actions"]').exists()).toBe(false);

    const card = wrapper.get('[data-testid="preset-card-root"][data-preset-id="p1"]');
    await card.trigger("click");

    expect(wrapper.find('[data-testid="preset-selection-actions"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it("emits exportSelectedToClipboard from split-button dropdown", async () => {
    const presets = [makePreset("p1", "One")];
    const wrapper = mount(PresetPanel, {
      props: {
        presets,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.get('[data-testid="preset-select-toggle"]').trigger("click");
    await wrapper.get('[data-testid="preset-export-menu"]').trigger("click");
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="preset-export-clipboard"]').trigger("click");
    const emitted = wrapper.emitted("exportSelectedToClipboard") as unknown[][] | undefined;
    expect(emitted?.[0]?.[0]).toEqual(["p1"]);

    wrapper.unmount();
  });

  it("emits duplicate and per-card export events", async () => {
    const presets = [makePreset("p1", "One")];
    const wrapper = mount(PresetPanel, {
      props: {
        presets,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.get('[data-testid="preset-card-duplicate"]').trigger("click");
    const duplicateEmitted = wrapper.emitted("duplicate") as unknown[][] | undefined;
    expect((duplicateEmitted?.[0]?.[0] as FFmpegPreset).id).toBe("p1");

    await wrapper.get('[data-testid="preset-card-export"]').trigger("click");
    const exportEmitted = wrapper.emitted("exportPresetToFile") as unknown[][] | undefined;
    expect((exportEmitted?.[0]?.[0] as FFmpegPreset).id).toBe("p1");

    wrapper.unmount();
  });

  it("emits importBundle when import button is clicked", async () => {
    const presets = [makePreset("p1", "One")];
    const wrapper = mount(PresetPanel, {
      props: {
        presets,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.get('[data-testid="preset-import-bundle"]').trigger("click");
    expect(wrapper.emitted("importBundle")).toBeTruthy();

    wrapper.unmount();
  });
});
