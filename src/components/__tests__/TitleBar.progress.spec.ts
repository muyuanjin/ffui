// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import TitleBar from "@/components/TitleBar.vue";
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

describe("TitleBar progress rendering", () => {
  it("renders progress via transform with a configurable transition duration", () => {
    const wrapper = mount(TitleBar, {
      props: {
        currentTitle: "Queue",
        currentVersion: "0.0.0",
        progressPercent: 25,
        progressVisible: true,
        progressFading: false,
        progressTransitionMs: 80,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Button: true,
          Select: true,
          SelectContent: true,
          SelectItem: true,
          SelectTrigger: true,
          SelectValue: true,
          Minus: true,
          Square: true,
          X: true,
        },
      },
    });

    const bar = wrapper.get('[data-testid="ffui-titlebar-progress"]');
    const style = bar.attributes("style");
    expect(style).toContain("translateX(-75%)");
    expect(style).toMatch(/transition-duration:\s*80ms/i);

    wrapper.unmount();
  });
});
