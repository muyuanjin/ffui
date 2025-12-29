// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import zhCN from "@/locales/zh-CN";

import SettingsTaskbarProgressSection from "./SettingsTaskbarProgressSection.vue";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: { "zh-CN": zhCN },
});

describe("SettingsTaskbarProgressSection titlebar progress toggle", () => {
  it("emits update:appSettings when toggled", async () => {
    const wrapper = mount(SettingsTaskbarProgressSection, {
      props: {
        appSettings: {
          taskbarProgressMode: "byEstimatedTime",
          taskbarProgressScope: "allJobs",
        } as any,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Card: { template: "<div><slot /></div>" },
          CardHeader: { template: "<div><slot /></div>" },
          CardTitle: { template: "<h3><slot /></h3>" },
          CardContent: { template: "<div><slot /></div>" },
          Select: { template: "<div><slot /></div>" },
          SelectTrigger: { template: "<button><slot /></button>" },
          SelectValue: { template: "<span><slot /></span>" },
          SelectContent: { template: "<div><slot /></div>" },
          SelectItem: { template: "<div><slot /></div>" },
          Switch: {
            props: ["modelValue"],
            emits: ["update:modelValue"],
            template: '<button v-bind="$attrs" @click="$emit(\'update:modelValue\', !modelValue)"></button>',
          },
        },
      },
    });

    await wrapper.get("[data-testid='settings-titlebar-progress-enabled']").trigger("click");

    const emitted = wrapper.emitted("update:appSettings");
    expect(emitted).toBeTruthy();
    expect((emitted?.[0]?.[0] as any).titlebarProgressEnabled).toBe(false);
  });
});
