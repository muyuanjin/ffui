// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueFiltersBar from "./QueueFiltersBar.vue";
import { getQueueReplayEligibility } from "@/lib/queueExecutionCapabilities";
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
    bulkWaitEligible: true,
    bulkResumeEligible: true,
    hasPrimarySortTies: false,
    queueMode: "display",
    visibleCount: 2,
    totalCount: 2,
  } as const;
}

describe("QueueFiltersBar bulk actions", () => {
  it("propagates transparent-only and mixed replay eligibility to the selection toolbar", async () => {
    const eligibility = getQueueReplayEligibility([{ status: "paused", executionMode: "transparent" }]);
    const wrapper = mount(QueueFiltersBar, {
      props: { ...makeDefaultProps(), bulkWaitEligible: eligibility.wait, bulkResumeEligible: eligibility.resume },
      global: { plugins: [i18n] },
    });
    const actions = en.queue.actions;
    expect(wrapper.get(`button[title="${actions.bulkWait}"]`).attributes("disabled")).toBeDefined();
    expect(wrapper.get(`button[title="${actions.bulkResume}"]`).attributes("disabled")).toBeDefined();
    const mixed = getQueueReplayEligibility([
      { status: "paused", executionMode: "transparent" },
      { status: "paused", executionMode: "managed" },
      { status: "processing", executionMode: "video" },
    ]);
    await wrapper.setProps({ bulkWaitEligible: mixed.wait, bulkResumeEligible: mixed.resume });
    expect(wrapper.get(`button[title="${actions.bulkWait}"]`).attributes("disabled")).toBeUndefined();
    expect(wrapper.get(`button[title="${actions.bulkResume}"]`).attributes("disabled")).toBeUndefined();
  });
  it("enables bulk wait/resume in display mode when there is a selection", async () => {
    const wrapper = mount(QueueFiltersBar, { props: makeDefaultProps(), global: { plugins: [i18n] } });

    const actions = (en as any).queue.actions as Record<string, string>;
    const bulkWait = wrapper.get(`button[title="${actions.bulkWait}"]`);
    const bulkResume = wrapper.get(`button[title="${actions.bulkResume}"]`);

    expect(bulkWait.attributes("disabled")).toBeUndefined();
    expect(bulkResume.attributes("disabled")).toBeUndefined();
  });
});
