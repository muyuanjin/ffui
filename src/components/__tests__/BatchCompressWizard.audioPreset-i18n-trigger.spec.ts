// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, nextTick } from "vue";

import BatchCompressWizard from "@/components/BatchCompressWizard.vue";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/lib/backend", () => ({ hasTauri: () => false }));
vi.mock("@/components/output/OutputPolicyEditor.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/batch-compress/BatchCompressSavingConditionSection.vue", () => ({
  default: { template: "<div />" },
}));

const SelectValueStub = defineComponent({
  props: {
    placeholder: { type: String, default: "" },
  },
  setup(props, { slots }) {
    return () => {
      const children = slots.default?.() ?? [];
      const hasAny = children.length > 0;
      return h("span", { "data-testid": "select-value" }, hasAny ? children : props.placeholder);
    };
  },
});

describe("BatchCompressWizard audio preset trigger i18n", () => {
  it("updates the trigger label immediately after locale switch", async () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      fallbackLocale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: {
          batchCompress: {
            audioPresetPlaceholder: "Choose audio preset",
            audioDefaultCompress: "Default audio compress",
          },
        },
        "zh-CN": {
          batchCompress: {
            audioPresetPlaceholder: "选择音频预设",
            audioDefaultCompress: "默认音频压缩",
          },
        },
      },
    });

    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [
          {
            id: "p1",
            name: "Preset 1",
            description: "",
            video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
            audio: { codec: "aac", bitrate: 192 },
            filters: {},
            stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
          },
        ],
        initialConfig: {
          audioPresetId: "",
          audioFilter: { enabled: true },
        } as any,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Button: { template: "<button><slot /></button>" },
          Input: { template: "<input />" },
          Label: { template: "<label><slot /></label>" },
          Checkbox: { template: "<div />" },
          Toggle: { template: "<button><slot /></button>" },
          Select: { template: "<div><slot /></div>" },
          SelectTrigger: { template: '<button v-bind="$attrs"><slot /></button>' },
          SelectValue: SelectValueStub,
          SelectContent: { template: "<div><slot /></div>" },
          SelectItem: { template: "<div><slot /></div>" },
        },
      },
    });

    expect(wrapper.get("[data-testid='batch-compress-audio-preset-trigger']").text()).toContain(
      "Default audio compress",
    );

    i18n.global.locale.value = "zh-CN";
    await nextTick();

    expect(wrapper.get("[data-testid='batch-compress-audio-preset-trigger']").text()).toContain("默认音频压缩");
  });
});
