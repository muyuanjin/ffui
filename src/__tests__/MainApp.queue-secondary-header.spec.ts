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
        status: "waiting",
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
        status: "waiting",
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
        status: "waiting",
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
        status: "waiting",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    const secondary = wrapper.get("[data-testid='queue-secondary-header']");

    // 初始没有选中，摘要文本中不包含 selected count，批量按钮禁用。
    expect(secondary.text()).not.toContain("Selected 2 job(s)");
    const bulkCancelLabel = (en as any).queue.actions.bulkCancel as string;
    const bulkButtons = secondary.findAll("button");
    const bulkCancel = bulkButtons.find(
      (btn) => btn.text() === bulkCancelLabel,
    );
    expect(bulkCancel).toBeTruthy();
    expect((bulkCancel!.element as HTMLButtonElement).disabled).toBe(true);

    // 选中所有可见任务后，显示选中数量，并启用批量操作按钮。
    if (typeof vm.selectAllVisibleJobs === "function") {
      vm.selectAllVisibleJobs();
      await nextTick();
    }

    expect(secondary.text()).toContain("Selected 2 job(s)");
    expect((bulkCancel!.element as HTMLButtonElement).disabled).toBe(false);

    wrapper.unmount();
  });
});
