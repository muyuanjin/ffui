// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueFiltersBar from "./QueueFiltersBar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueFilterKind, QueueFilterStatus } from "@/composables";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any, "zh-CN": zhCN as any },
});

function makeDefaultProps() {
  return {
    activeStatusFilters: new Set<QueueFilterStatus>(),
    activeTypeFilters: new Set<QueueFilterKind>(),
    filterText: "",
    filterUseRegex: false,
    filterRegexError: null as string | null,
    sortPrimary: "addedTime",
    sortPrimaryDirection: "desc",
    sortSecondary: "filename",
    sortSecondaryDirection: "asc",
    hasActiveFilters: false,
    hasSelection: true,
    selectedCount: 2,
    hasPrimarySortTies: false,
    queueMode: "display",
    visibleCount: 2,
    totalCount: 2,
  } as const;
}

describe("QueueFiltersBar bulk actions", () => {
  it("enables bulk wait/resume in display mode when there is a selection", async () => {
    const wrapper = mount(QueueFiltersBar, { props: makeDefaultProps(), global: { plugins: [i18n] } });

    const bulkWait = wrapper.get('button[title="Wait selected"]');
    const bulkResume = wrapper.get('button[title="Resume selected"]');

    expect(bulkWait.attributes("disabled")).toBeUndefined();
    expect(bulkResume.attributes("disabled")).toBeUndefined();
  });
});
