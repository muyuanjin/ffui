// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import QueueFiltersBar from "@/components/panels/queue/QueueFiltersBar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueFilterKind, QueueFilterStatus, QueueSortField } from "@/composables";
import type { QueueSortDirection } from "@/composables";
import type { QueueMode } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

function createWrapper(options?: {
  sortPrimaryDirection?: QueueSortDirection;
  sortSecondaryDirection?: QueueSortDirection;
  hasPrimarySortTies?: boolean;
}) {
  const sortPrimaryDirection: QueueSortDirection = options?.sortPrimaryDirection ?? "asc";
  const sortSecondaryDirection: QueueSortDirection = options?.sortSecondaryDirection ?? "asc";
  const hasPrimarySortTies = options?.hasPrimarySortTies ?? false;

  const statusSet = new Set<QueueFilterStatus>();
  const typeSet = new Set<QueueFilterKind>();

  const wrapper = mount(QueueFiltersBar, {
    props: {
      activeStatusFilters: statusSet,
      activeTypeFilters: typeSet,
      filterText: "",
      filterUseRegex: false,
      filterRegexError: null,
      sortPrimary: "addedTime" as QueueSortField,
      sortPrimaryDirection,
      sortSecondary: "filename" as QueueSortField,
      sortSecondaryDirection,
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

  return wrapper;
}

describe("QueueFiltersBar sort direction toggles", () => {
  it("toggles primary sort direction between asc and desc via a single button", async () => {
    const wrapper = createWrapper({ sortPrimaryDirection: "asc" });
    const toggle = wrapper.get("[data-testid='queue-sort-primary-direction-toggle']");

    // 初始为升序
    expect(toggle.text()).toBe((en as any).queue.sort.asc);

    // 第一次点击：从 asc 切换到 desc
    await toggle.trigger("click");
    const firstEmit = wrapper.emitted("update:sortPrimaryDirection");
    expect(firstEmit).toBeTruthy();
    expect(firstEmit?.[0]).toEqual(["desc"]);

    // 模拟父组件应用更新后的方向，按钮文案也随之更新
    await wrapper.setProps({ sortPrimaryDirection: "desc" as QueueSortDirection });
    await nextTick();
    expect(toggle.text()).toBe((en as any).queue.sort.desc);

    // 第二次点击：从 desc 切换回 asc
    await toggle.trigger("click");
    const secondEmit = wrapper.emitted("update:sortPrimaryDirection");
    expect(secondEmit?.[1]).toEqual(["asc"]);

    wrapper.unmount();
  });

  it("toggles secondary sort direction between asc and desc via a single button", async () => {
    const wrapper = createWrapper({
      sortSecondaryDirection: "desc",
      hasPrimarySortTies: true,
    });
    const toggle = wrapper.get("[data-testid='queue-sort-secondary-direction-toggle']");

    // 初始为降序
    expect(toggle.text()).toBe((en as any).queue.sort.desc);

    // 第一次点击：从 desc 切换到 asc
    await toggle.trigger("click");
    const firstEmit = wrapper.emitted("update:sortSecondaryDirection");
    expect(firstEmit).toBeTruthy();
    expect(firstEmit?.[0]).toEqual(["asc"]);

    // 模拟父组件应用更新后的方向，按钮文案也随之更新
    await wrapper.setProps({
      sortSecondaryDirection: "asc" as QueueSortDirection,
    });
    await nextTick();
    expect(toggle.text()).toBe((en as any).queue.sort.asc);

    // 第二次点击：从 asc 切换回 desc
    await toggle.trigger("click");
    const secondEmit = wrapper.emitted("update:sortSecondaryDirection");
    expect(secondEmit?.[1]).toEqual(["desc"]);

    wrapper.unmount();
  });
});
