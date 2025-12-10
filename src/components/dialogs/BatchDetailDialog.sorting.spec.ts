// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import BatchDetailDialog from "@/components/dialogs/BatchDetailDialog.vue";
import type { TranscodeJob } from "@/types";
import {
  createMockBatch,
  createMockJob,
  createMockPreset,
  createMountOptions,
} from "./BatchDetailDialog.test-utils";

describe("BatchDetailDialog 子任务排序", () => {
  const presets = [createMockPreset("p1")];

  it("不传入 sortCompareFn 时，子任务按原始顺序显示", async () => {
    const jobs = [
      { ...createMockJob("job-c", "waiting"), filename: "C:/videos/charlie.mp4" },
      { ...createMockJob("job-a", "waiting"), filename: "C:/videos/alpha.mp4" },
      { ...createMockJob("job-b", "waiting"), filename: "C:/videos/beta.mp4" },
    ];
    const batch = createMockBatch(jobs);

    const wrapper = mount(BatchDetailDialog, createMountOptions(batch, presets));

    await flushPromises();
    await nextTick();

    const renderedIds = wrapper
      .findAll("[data-testid='queue-item-stub']")
      .map((el) => el.attributes("data-job-id"));

    expect(renderedIds).toEqual(["job-c", "job-a", "job-b"]);
  });

  it("传入 sortCompareFn 时，子任务按排序函数排序（按文件名升序）", async () => {
    const jobs = [
      { ...createMockJob("job-c", "waiting"), filename: "C:/videos/charlie.mp4" },
      { ...createMockJob("job-a", "waiting"), filename: "C:/videos/alpha.mp4" },
      { ...createMockJob("job-b", "waiting"), filename: "C:/videos/beta.mp4" },
    ];
    const batch = createMockBatch(jobs);

    const sortByFilenameAsc = (a: TranscodeJob, b: TranscodeJob) =>
      (a.filename || "").localeCompare(b.filename || "");

    const wrapper = mount(BatchDetailDialog, {
      ...createMountOptions(batch, presets),
      props: {
        ...createMountOptions(batch, presets).props,
        sortCompareFn: sortByFilenameAsc,
      },
    });

    await flushPromises();
    await nextTick();

    const renderedIds = wrapper
      .findAll("[data-testid='queue-item-stub']")
      .map((el) => el.attributes("data-job-id"));

    expect(renderedIds).toEqual(["job-a", "job-b", "job-c"]);
  });

  it("传入 sortCompareFn 时，子任务按排序函数排序（按文件名降序）", async () => {
    const jobs = [
      { ...createMockJob("job-a", "waiting"), filename: "C:/videos/alpha.mp4" },
      { ...createMockJob("job-b", "waiting"), filename: "C:/videos/beta.mp4" },
      { ...createMockJob("job-c", "waiting"), filename: "C:/videos/charlie.mp4" },
    ];
    const batch = createMockBatch(jobs);

    const sortByFilenameDesc = (a: TranscodeJob, b: TranscodeJob) =>
      (b.filename || "").localeCompare(a.filename || "");

    const wrapper = mount(BatchDetailDialog, {
      ...createMountOptions(batch, presets),
      props: {
        ...createMountOptions(batch, presets).props,
        sortCompareFn: sortByFilenameDesc,
      },
    });

    await flushPromises();
    await nextTick();

    const renderedIds = wrapper
      .findAll("[data-testid='queue-item-stub']")
      .map((el) => el.attributes("data-job-id"));

    expect(renderedIds).toEqual(["job-c", "job-b", "job-a"]);
  });

  it("排序不影响 skipped 状态的任务（它们被过滤掉）", async () => {
    const jobs = [
      { ...createMockJob("job-c", "waiting"), filename: "C:/videos/charlie.mp4" },
      { ...createMockJob("job-skipped", "skipped"), filename: "C:/videos/skipped.mp4" },
      { ...createMockJob("job-a", "waiting"), filename: "C:/videos/alpha.mp4" },
    ];
    const batch = createMockBatch(jobs);

    const sortByFilenameAsc = (a: TranscodeJob, b: TranscodeJob) =>
      (a.filename || "").localeCompare(b.filename || "");

    const wrapper = mount(BatchDetailDialog, {
      ...createMountOptions(batch, presets),
      props: {
        ...createMountOptions(batch, presets).props,
        sortCompareFn: sortByFilenameAsc,
      },
    });

    await flushPromises();
    await nextTick();

    const renderedIds = wrapper
      .findAll("[data-testid='queue-item-stub']")
      .map((el) => el.attributes("data-job-id"));

    expect(renderedIds).toEqual(["job-a", "job-c"]);
    expect(renderedIds).not.toContain("job-skipped");
  });
});
