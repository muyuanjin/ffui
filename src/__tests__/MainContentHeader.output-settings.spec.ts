// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick } from "vue";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { OutputPolicy } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainContentHeader output settings", () => {
  it("emits update:queueOutputPolicy from the output settings dialog", async () => {
    const initialPolicy: OutputPolicy = {
      container: { mode: "default" },
      directory: { mode: "sameAsInput" },
      filename: { suffix: ".compressed" },
      preserveFileTimes: false,
    };

    const OutputPolicyEditorStub = defineComponent({
      name: "OutputPolicyEditor",
      props: {
        modelValue: { type: Object, required: true },
      },
      emits: ["update:modelValue"],
      template: `
        <div data-testid="output-policy-editor-stub">
          <button
            type="button"
            data-testid="output-policy-emit"
            @click="$emit('update:modelValue', { ...modelValue, preserveFileTimes: true })"
          >
            emit
          </button>
        </div>
      `,
    });

    const DialogStub = defineComponent({
      name: "Dialog",
      props: {
        open: { type: Boolean, default: false },
      },
      emits: ["update:open"],
      template: `<div v-if="open" data-testid="dialog"><slot /></div>`,
    });

    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "Sub",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: null,
        presets: [],
        queueViewModeModel: "detail",
        presetSortMode: "manual",
        queueOutputPolicy: initialPolicy,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: DialogStub,
          DialogContent: { template: `<div><slot /></div>` },
          DialogHeader: { template: `<div><slot /></div>` },
          DialogTitle: { template: `<div><slot /></div>` },
          OutputPolicyEditor: OutputPolicyEditorStub,
          Select: { template: `<div><slot /></div>` },
          SelectContent: { template: `<div><slot /></div>` },
          SelectItem: { template: `<div><slot /></div>` },
          SelectTrigger: { template: `<div><slot /></div>` },
          SelectValue: { template: `<div><slot /></div>` },
        },
      },
    });

    expect(wrapper.find("[data-testid='output-policy-editor-stub']").exists()).toBe(false);

    const openButton = wrapper.get("[data-testid='ffui-queue-output-settings']");
    expect(openButton.text()).toContain("Output settings");
    await openButton.trigger("click");
    await nextTick();

    const editor = wrapper.get("[data-testid='output-policy-editor-stub']");
    await editor.get("[data-testid='output-policy-emit']").trigger("click");
    await nextTick();

    const emitted = wrapper.emitted("update:queueOutputPolicy");
    expect(emitted).toBeTruthy();
    expect(emitted?.[0]?.[0]).toMatchObject({ preserveFileTimes: true });
  });
});
