// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { computed, defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useQueueFiltering } from "./useQueueFiltering";
import type { CompositeBatchCompressTask, TranscodeJob } from "@/types";

describe("useQueueFiltering persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists and restores filter state via localStorage", async () => {
    const jobs = ref<TranscodeJob[]>([]);

    const Harness = defineComponent({
      setup() {
        return useQueueFiltering({
          jobs,
          compositeBatchCompressTasks: computed<CompositeBatchCompressTask[]>(() => []),
          compositeTasksById: computed(() => new Map<string, CompositeBatchCompressTask>()),
        });
      },
      template: "<div />",
    });

    const first = mount(Harness);
    const vm1: any = first.vm;

    vm1.filterText = "running";
    vm1.filterUseRegex = true;
    vm1.toggleStatusFilter("processing");
    vm1.toggleTypeFilter("manual");

    await nextTick();
    first.unmount();

    const second = mount(Harness);
    const vm2: any = second.vm;
    expect(vm2.filterText).toBe("running");
    expect(vm2.filterUseRegex).toBe(true);
    expect(vm2.activeStatusFilters.has("processing")).toBe(true);
    expect(vm2.activeTypeFilters.has("manual")).toBe(true);

    second.unmount();
  });

  it("ignores malformed persisted filters", () => {
    window.localStorage.setItem("ffui.queueFilterStatus", "not-json");
    window.localStorage.setItem("ffui.queueFilterKind", '{"bad":true}');

    const jobs = ref<TranscodeJob[]>([]);
    const state = useQueueFiltering({
      jobs,
      compositeBatchCompressTasks: computed<CompositeBatchCompressTask[]>(() => []),
      compositeTasksById: computed(() => new Map<string, CompositeBatchCompressTask>()),
    });

    expect(state.activeStatusFilters.value.size).toBe(0);
    expect(state.activeTypeFilters.value.size).toBe(0);
  });
});
