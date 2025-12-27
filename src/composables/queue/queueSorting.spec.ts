// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computed, defineComponent, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { createQueueSortingState } from "./queueSorting";

describe("createQueueSortingState", () => {
  it("re-sorts only when ordering-relevant fields change", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "a",
        inputPath: "/b.mp4",
        status: "queued",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "b",
        inputPath: "/a.mp4",
        status: "queued",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    // Intentionally stable reference: simulates "in-place job patching" where
    // the filtered list identity doesn't change on every backend snapshot.
    const filteredJobs = computed(() => jobs.value);

    const sortPrimary = ref("filename" as any);
    const sortPrimaryDirection = ref("asc" as any);
    const sortSecondary = ref("filename" as any);
    const sortSecondaryDirection = ref("asc" as any);

    let state: ReturnType<typeof createQueueSortingState> | undefined;

    const wrapper = mount(
      defineComponent({
        setup() {
          state = createQueueSortingState({
            filteredJobs,
            sortPrimary,
            sortPrimaryDirection,
            sortSecondary,
            sortSecondaryDirection,
          });
          return {};
        },
        template: "<div />",
      }),
    );

    await nextTick();
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["b", "a"]);
    const prevSorted = state?.displayModeSortedJobs.value as unknown as TranscodeJob[];

    // Unrelated field update: should not restart sorting.
    (jobs.value[0] as any).logLines = ["hello"];
    await nextTick();
    expect(state?.displayModeSortedJobs.value).toBe(prevSorted);

    // Ordering-relevant update: filename changes via inputPath.
    (jobs.value[0] as any).inputPath = "/0.mp4";
    await nextTick();
    expect(state?.displayModeSortedJobs.value).not.toBe(prevSorted);
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["a", "b"]);

    wrapper.unmount();
  });

  it("uses queueProgressRevision as the trigger for progress-based sorting", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "a",
        inputPath: "/a.mp4",
        status: "processing",
        progress: 10,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "b",
        inputPath: "/b.mp4",
        status: "processing",
        progress: 50,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    const filteredJobs = computed(() => jobs.value);

    const sortPrimary = ref("progress" as any);
    const sortPrimaryDirection = ref("desc" as any);
    const sortSecondary = ref("filename" as any);
    const sortSecondaryDirection = ref("asc" as any);

    const queueProgressRevision = ref(0);

    let state: ReturnType<typeof createQueueSortingState> | undefined;

    const wrapper = mount(
      defineComponent({
        setup() {
          state = createQueueSortingState({
            filteredJobs,
            sortPrimary,
            sortPrimaryDirection,
            sortSecondary,
            sortSecondaryDirection,
            queueProgressRevision,
          });
          return {};
        },
        template: "<div />",
      }),
    );

    await nextTick();
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["b", "a"]);
    const prevSorted = state?.displayModeSortedJobs.value as unknown as TranscodeJob[];

    // Progress value changes alone should not restart sorting when a dedicated
    // progress revision is supplied (sorting is driven by delta/apply).
    (jobs.value[0] as any).progress = 90;
    await nextTick();
    expect(state?.displayModeSortedJobs.value).toBe(prevSorted);

    // Once the revision bumps, the order updates.
    queueProgressRevision.value += 1;
    await nextTick();
    expect(state?.displayModeSortedJobs.value).not.toBe(prevSorted);
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["a", "b"]);

    wrapper.unmount();
  });

  it("always surfaces processing jobs in queue mode even when status filters hide them", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "processing",
        inputPath: "/processing.mp4",
        status: "processing",
        progress: 1,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "queued",
        inputPath: "/queued.mp4",
        status: "queued",
        progress: 0,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    // Simulate status filters that hide processing jobs in the main list.
    const filteredJobs = computed(() => jobs.value.filter((job) => job.status === "queued"));
    const filteredJobsIgnoringStatus = computed(() => jobs.value);

    const sortPrimary = ref("filename" as any);
    const sortPrimaryDirection = ref("asc" as any);
    const sortSecondary = ref("filename" as any);
    const sortSecondaryDirection = ref("asc" as any);

    let state: ReturnType<typeof createQueueSortingState> | undefined;

    const wrapper = mount(
      defineComponent({
        setup() {
          state = createQueueSortingState({
            filteredJobs,
            filteredJobsIgnoringStatus,
            sortPrimary,
            sortPrimaryDirection,
            sortSecondary,
            sortSecondaryDirection,
          });
          return {};
        },
        template: "<div />",
      }),
    );

    await nextTick();
    expect(state?.queueModeProcessingJobs.value.map((job) => job.id)).toEqual(["processing"]);

    wrapper.unmount();
  });
});
