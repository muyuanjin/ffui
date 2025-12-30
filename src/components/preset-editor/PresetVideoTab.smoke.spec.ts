// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { createI18n } from "vue-i18n";

import PresetVideoTab from "./PresetVideoTab.vue";
import en from "@/locales/en";

// reka-ui Select depends on ResizeObserver in jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;

const i18n = (createI18n as any)({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

describe("PresetVideoTab (smoke)", () => {
  it("renders non-empty encoder/preset triggers for AV1 NVENC smart preset states", () => {
    const video = reactive({
      encoder: "av1_nvenc",
      rateControl: "constqp",
      qualityValue: 18,
      preset: "p7",
      tune: "hq",
    } as any);

    const wrapper = mount(PresetVideoTab, {
      props: {
        video,
        isCopyEncoder: false,
        rateControlLabel: "CQ",
      },
      global: { plugins: [i18n] },
    });

    const text = wrapper.text();
    expect(text).toContain("av1_nvenc");
    expect(text).toContain("p7");
  });
});
