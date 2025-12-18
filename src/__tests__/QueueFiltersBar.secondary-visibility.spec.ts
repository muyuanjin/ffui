// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueFilterKind, QueueFilterStatus, QueueSortField } from "@/composables";
import type { QueueMode } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

function mountBar(hasPrimarySortTies: boolean) {
  const statusSet = new Set<QueueFilterStatus>();
  const typeSet = new Set<QueueFilterKind>();

  return mount(QueueFiltersBar, {
    props: {
      activeStatusFilters: statusSet,
      activeTypeFilters: typeSet,
      filterText: "",
      filterUseRegex: false,
      filterRegexError: null,
      sortPrimary: "addedTime" as QueueSortField,
      sortPrimaryDirection: "asc",
      sortSecondary: "filename" as QueueSortField,
      sortSecondaryDirection: "asc",
      hasActiveFilters: false,
      hasSelection: false,
      selectedCount: 0,
      hasPrimarySortTies,
      queueMode: "display" as QueueMode,
      visibleCount: 0,
      totalCount: 0,
    },
    global: {
      plugins: [i18n],
    },
  });
}

describe("QueueFiltersBar secondary sort visibility", () => {
  it("keeps secondary sort controls collapsed by default when there are no primary sort ties", () => {
    const wrapper = mountBar(false);

    // 没有主排序字段冲突时，只显示“二级排序”展开按钮，不显示完整二级排序行。
    expect(wrapper.find("[data-testid='queue-secondary-sort-row']").exists()).toBe(false);

    const expandBtn = wrapper.get("[data-testid='queue-secondary-sort-expand']");
    expect(expandBtn.text()).toBe((en as any).queue.sort.secondaryLabel);

    wrapper.unmount();
  });

  it("auto-expands secondary sort controls when primary sort ties are detected", () => {
    const wrapper = mountBar(true);

    // 有主排序字段冲突时，组件会自动展开二级排序区域。
    expect(wrapper.find("[data-testid='queue-secondary-sort-row']").exists()).toBe(true);

    wrapper.unmount();
  });

  it("renders primary and secondary sort labels without wrapping to keep Chinese text horizontal", () => {
    const wrapper = mountBar(true);

    const primaryLabel = wrapper.get("[data-testid='queue-sort-primary-label']");
    expect(primaryLabel.classes()).toContain("whitespace-nowrap");

    const secondaryLabel = wrapper.get("[data-testid='queue-sort-secondary-label']");
    expect(secondaryLabel.classes()).toContain("whitespace-nowrap");

    wrapper.unmount();
  });
});
