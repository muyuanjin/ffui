// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import type { TranscodeJob } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

// 轻量 stub，避免在这些结构性测试里加载完整卡片实现。
const queueItemStub = {
  props: ["job", "preset"],
  template: `<div data-testid="queue-item-stub">{{ job.id }}</div>`,
};

function setJobs(vm: any, jobs: TranscodeJob[]) {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
}

describe("MainApp queue secondary header", () => {
  it("renders the secondary header directly under the main header when queue tab is active", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];
    setJobs(vm, jobs);
    await nextTick();

    const main = wrapper.get("main");
    // .get 若找不到会直接抛错，这里无需额外调用 exists()
    const secondary = main.get("[data-testid='queue-secondary-header']");

    // 二级 header 在队列内容顶部只渲染一次，而不是散落在每个任务卡片里。
    const allSecondary = main.findAll("[data-testid='queue-secondary-header']");
    expect(allSecondary.length).toBe(1);
    expect(allSecondary[0].element).toBe(secondary.element);

    wrapper.unmount();
  });

  it("keeps the sorting row visible while toggling the filter panel", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];
    setJobs(vm, jobs);
    await nextTick();

    const secondary = wrapper.get("[data-testid='queue-secondary-header']");
    // 排序区域始终可见，包含 Sort 标签与排序字段选择框。
    expect(secondary.text()).toContain("Sort");
    expect(secondary.text()).toContain("Added time");

    wrapper.unmount();
  });

  it("shows selected count and enables bulk actions only when there is a selection", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
      {
        id: "job-2",
        filename: "C:/videos/b.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    const secondary = wrapper.get("[data-testid='queue-secondary-header']");

    // 初始没有选中，Secondary Header 中不展示选中数量，也不展示批量操作按钮。
    expect(secondary.text()).not.toContain("Selected 2");
    const bulkCancelLabel = (en as any).queue.actions.bulkCancel as string;
    const bulkButtonsBefore = secondary.findAll("button");
    expect(bulkButtonsBefore.some((btn) => btn.text() === bulkCancelLabel)).toBe(false);

    // 选中所有可见任务后，显示选中数量，并启用批量操作按钮。
    if (typeof vm.selectAllVisibleJobs === "function") {
      vm.selectAllVisibleJobs();
      await nextTick();
    }

    // 有选中时，显示选中数量，并出现批量操作按钮。
    const bulkButtonsAfter = secondary.findAll("button");
    const bulkCancel = bulkButtonsAfter.find((btn) => btn.text() === bulkCancelLabel);
    expect(secondary.text()).toContain("Selected 2");
    expect(bulkCancel).toBeTruthy();

    wrapper.unmount();
  });

  it("keeps the secondary header visible when filters hide all queue items but jobs still exist", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) {
      vm.queueModeModel = "display";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
      {
        id: "job-2",
        filename: "C:/videos/b.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    // Sanity check: header is visible before applying filters. `.get` will
    // throw if it cannot find the element, so the call itself is the presence check.
    const before = wrapper.get("[data-testid='queue-secondary-header']");
    expect(before).toBeTruthy();

    // Apply a text filter that matches no jobs so the filtered list becomes empty,
    // while underlying jobs still exist.
    if ("filterText" in vm) {
      vm.filterText = "no-such-filename-xyz";
    }
    await nextTick();

    // All queue items are hidden by filters.
    expect(wrapper.findAll("[data-testid='queue-item-stub']").length).toBe(0);

    // Regression guard: the secondary header must remain visible so users can
    // clear or adjust filters instead of being stuck on the empty CTA.
    const secondary = wrapper.get("[data-testid='queue-secondary-header']");
    expect(secondary).toBeTruthy();

    wrapper.unmount();
  });

  it("does not leak raw queue.status.* keys into the secondary header UI", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "queue";
    if ("queueModeModel" in vm) {
      vm.queueModeModel = "display";
    }

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    const secondary = wrapper.get("[data-testid='queue-secondary-header']");
    expect(secondary.text()).not.toContain("queue.status.");

    wrapper.unmount();
  });
});
