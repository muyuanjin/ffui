// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import PresetFiltersTab from "./PresetFiltersTab.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { FilterConfig } from "@/types";

const makeI18n = () =>
  createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: en as any,
      "zh-CN": zhCN as any,
    },
  });

const mountFiltersTab = (filters: FilterConfig) =>
  mount(PresetFiltersTab, {
    props: { filters },
    global: { plugins: [makeI18n()] },
  });

describe("PresetFiltersTab", () => {
  it("stores rational fps expression when a quick pick is selected", async () => {
    const filters: FilterConfig = {};
    const wrapper = mountFiltersTab(filters);

    await wrapper.get('[data-testid="preset-filter-fps-quick-30000/1001"]').trigger("click");

    expect(filters.fps).toBe("30000/1001");
    wrapper.unmount();
  });

  it("preserves manually typed decimal fps expression", async () => {
    const filters: FilterConfig = {};
    const wrapper = mountFiltersTab(filters);

    await wrapper.get('[data-testid="preset-filter-fps"]').setValue("29.97");

    expect(filters.fps).toBe("29.97");
    wrapper.unmount();
  });
});
