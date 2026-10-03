// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainContentHeader default preset select style", () => {
  it("shares settings button geometry while distinguishing preset and output colors", () => {
    const DialogStub = defineComponent({
      name: "Dialog",
      props: { open: { type: Boolean, default: false } },
      template: `<div v-if="open"><slot /></div>`,
    });

    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "Sub",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: "p1",
        presets: [{ id: "p1", name: "Universal 1080p" } as any],
        queueViewModeModel: "detail",
        presetSortMode: "manual",
      },
      global: {
        plugins: [i18n],
        stubs: {
          HoverCard: { template: `<div><slot /></div>` },
          HoverCardTrigger: { template: `<div><slot /></div>` },
          HoverCardContent: { template: `<div><slot /></div>` },
          Dialog: DialogStub,
          DialogContent: { template: `<div><slot /></div>` },
          DialogHeader: { template: `<div><slot /></div>` },
          DialogTitle: { template: `<div><slot /></div>` },
          OutputPolicyEditor: { template: `<div />` },
          Select: { template: `<div><slot /></div>` },
          SelectContent: { template: `<div><slot /></div>` },
          SelectItem: { template: `<div><slot /></div>` },
          SelectTrigger: { template: `<button v-bind="$attrs"><slot /></button>` },
          SelectValue: { template: `<span />` },
        },
      },
    });

    const trigger = wrapper.get("[data-testid='ffui-queue-default-preset-trigger']");
    const className = trigger.attributes("class") ?? "";

    const outputClassName = wrapper.get('[data-testid="ffui-queue-output-settings"]').attributes("class") ?? "";
    for (const sharedClass of ["h-7", "rounded-full", "rounded-l-none", "px-3", "py-0", "text-xs", "font-semibold"]) {
      expect(trigger.classes()).toContain(sharedClass);
      expect(wrapper.get('[data-testid="ffui-queue-output-settings"]').classes()).toContain(sharedClass);
    }
    expect(className).toContain("bg-sky-700/90");
    expect(className).toContain("hover:bg-sky-800/90");
    expect(className).not.toContain("bg-[#b89069]/90");
    expect(outputClassName).toContain("bg-[#b89069]/90");
    expect(outputClassName).toContain("hover:bg-[#f9a825]/90");
    expect(outputClassName).not.toContain("bg-sky-700/90");
    expect(className).not.toContain("w-full");
    expect(trigger.text()).toBe("Default preset");
    expect(wrapper.get('[data-testid="queue-preset-summary-badge"]').text()).toBe("Universal 1080p");
    expect(wrapper.find('[data-testid="queue-preset-selection-mode"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="queue-preset-summary-badge"]').attributes("class")).toBe(
      wrapper.get('[data-testid="ffui-queue-output-container-badge"]').attributes("class"),
    );
    wrapper.unmount();
  });
});
