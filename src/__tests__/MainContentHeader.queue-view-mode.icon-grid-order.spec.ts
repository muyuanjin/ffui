// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import MainContentHeader from "@/components/main/MainContentHeader.vue";
import en from "@/locales/en";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

describe("MainContentHeader queue view mode", () => {
  it("orders icon grid sizes as large → medium → small", () => {
    const wrapper = mount(MainContentHeader, {
      props: {
        activeTab: "queue",
        currentTitle: "Queue",
        currentSubtitle: "",
        jobsLength: 0,
        completedCount: 0,
        manualJobPresetId: null,
        presets: [],
        queueViewModeModel: "detail",
      } as any,
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: "<div><slot /></div>" },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          OutputPolicyEditor: { template: "<div />" },
          HoverCard: { template: "<div><slot /></div>" },
          HoverCardTrigger: { template: "<div><slot /></div>" },
          HoverCardContent: { template: "<div><slot /></div>" },
          Select: { template: "<div><slot /></div>" },
          SelectTrigger: { template: "<div><slot /></div>" },
          SelectValue: { template: "<div><slot /></div>" },
          SelectContent: { template: "<div><slot /></div>" },
          SelectItem: {
            props: ["value"],
            template: '<div v-bind="$attrs" :data-value="value"><slot /></div>',
          },
        },
      },
    });

    const icons = wrapper.findAll(
      [
        "[data-testid='ffui-queue-view-mode-icon-large']",
        "[data-testid='ffui-queue-view-mode-icon-medium']",
        "[data-testid='ffui-queue-view-mode-icon-small']",
      ].join(","),
    );

    expect(icons.map((el) => el.attributes("data-value"))).toEqual(["icon-large", "icon-medium", "icon-small"]);
  });
});
