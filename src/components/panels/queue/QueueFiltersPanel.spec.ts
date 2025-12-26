// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import QueueFiltersPanel from "./QueueFiltersPanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueFilterKind, QueueFilterStatus } from "@/composables";

// reka-ui 的浮层组件依赖 ResizeObserver，这里在测试环境中提供一个最小 mock。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;

const makeI18n = (locale: "en" | "zh-CN") =>
  (createI18n as any)({
    legacy: false,
    locale,
    messages: { en: en as any, "zh-CN": zhCN as any },
  });

function makeDefaultProps() {
  return {
    activeStatusFilters: new Set<QueueFilterStatus>(),
    activeTypeFilters: new Set<QueueFilterKind>(),
    filterText: "",
    filterUseRegex: false,
    filterRegexError: null as string | null,
  } as const;
}

describe("QueueFiltersPanel", () => {
  it("uses different placeholders for token vs regex mode", async () => {
    const i18n = makeI18n("en");
    const t = (key: string) => String(i18n.global.t(key));

    const wrapper = mount(QueueFiltersPanel, {
      props: makeDefaultProps(),
      attachTo: document.body,
      global: { plugins: [i18n] },
    });

    const input = wrapper.get('input[data-testid="queue-filter-text-input"]');
    expect(input.attributes("placeholder")).toBe(t("queue.filters.textPlaceholderTokens"));

    await wrapper.setProps({ filterUseRegex: true });
    expect(input.attributes("placeholder")).toBe(t("queue.filters.textPlaceholderRegex"));

    wrapper.unmount();
  });

  it("shows examples popover when focusing the input", async () => {
    const i18n = makeI18n("en");
    const t = (key: string) => String(i18n.global.t(key));

    const wrapper = mount(QueueFiltersPanel, {
      props: makeDefaultProps(),
      attachTo: document.body,
      global: { plugins: [i18n] },
    });

    const input = wrapper.get('input[data-testid="queue-filter-text-input"]');
    await input.trigger("focus");
    await nextTick();

    const examples = wrapper.get('[data-testid="queue-filter-text-examples"]');
    expect(examples.text()).toContain(t("queue.filters.textExamplesTitle"));
    expect(examples.text()).toContain("size>20mb");

    await wrapper.setProps({ filterUseRegex: true });
    await nextTick();
    expect(examples.text()).toContain("^.*\\.mp4$");

    wrapper.unmount();
  });

  it("renders the zh-CN label as 条件筛选", () => {
    const i18n = makeI18n("zh-CN");

    const wrapper = mount(QueueFiltersPanel, {
      props: makeDefaultProps(),
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain("条件筛选");
  });
});
