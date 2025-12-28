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

  it("keeps unfinished jobs at the bottom when sorting by finishedTime", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "done-new",
        inputPath: "/done-new.mp4",
        status: "success",
        endTime: 200,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "unfinished",
        inputPath: "/unfinished.mp4",
        status: "queued",
        endTime: undefined,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "done-old",
        inputPath: "/done-old.mp4",
        status: "success",
        endTime: 100,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    const filteredJobs = computed(() => jobs.value);

    const sortPrimary = ref("finishedTime" as any);
    const sortPrimaryDirection = ref("desc" as any);
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
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["done-new", "done-old", "unfinished"]);

    sortPrimaryDirection.value = "asc" as any;
    await nextTick();
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["done-old", "done-new", "unfinished"]);

    wrapper.unmount();
  });

  it("sorts by createdTime/modifiedTime using filesystem timestamps (missing values stay at bottom)", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "t2",
        inputPath: "/t2.mp4",
        status: "queued",
        createdTimeMs: 200,
        modifiedTimeMs: 220,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "missing",
        inputPath: "/missing.mp4",
        status: "queued",
        createdTimeMs: undefined,
        modifiedTimeMs: undefined,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "t1",
        inputPath: "/t1.mp4",
        status: "queued",
        createdTimeMs: 100,
        modifiedTimeMs: 110,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    const filteredJobs = computed(() => jobs.value);

    const sortPrimary = ref("createdTime" as any);
    const sortPrimaryDirection = ref("desc" as any);
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
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["t2", "t1", "missing"]);

    sortPrimary.value = "modifiedTime" as any;
    await nextTick();
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["t2", "t1", "missing"]);

    sortPrimaryDirection.value = "asc" as any;
    await nextTick();
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual(["t1", "t2", "missing"]);

    wrapper.unmount();
  });

  it("sorts by status using the UX semantic order (not lexicographic)", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "processing",
        inputPath: "/processing.mp4",
        status: "processing",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "queued",
        inputPath: "/queued.mp4",
        status: "queued",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "paused",
        inputPath: "/paused.mp4",
        status: "paused",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "completed",
        inputPath: "/completed.mp4",
        status: "completed",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "failed",
        inputPath: "/failed.mp4",
        status: "failed",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "cancelled",
        inputPath: "/cancelled.mp4",
        status: "cancelled",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "skipped",
        inputPath: "/skipped.mp4",
        status: "skipped",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    const filteredJobs = computed(() => jobs.value);

    const sortPrimary = ref("status" as any);
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
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual([
      "processing",
      "queued",
      "paused",
      "completed",
      "failed",
      "cancelled",
      "skipped",
    ]);

    sortPrimaryDirection.value = "desc" as any;
    await nextTick();
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual([
      "skipped",
      "cancelled",
      "failed",
      "completed",
      "paused",
      "queued",
      "processing",
    ]);

    wrapper.unmount();
  });

  it("sorts by elapsed using processing time (elapsedMs/best-effort fallback)", async () => {
    const jobs = ref<TranscodeJob[]>([
      reactive({
        id: "completed-fast",
        inputPath: "/completed-fast.mp4",
        status: "completed",
        elapsedMs: 10,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "completed-fallback",
        inputPath: "/completed-fallback.mp4",
        status: "completed",
        processingStartedMs: 100,
        endTime: 600,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "unfinished",
        inputPath: "/unfinished.mp4",
        status: "queued",
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
      reactive({
        id: "completed-slow",
        inputPath: "/completed-slow.mp4",
        status: "completed",
        elapsedMs: 1000,
        type: "video",
        source: "manual",
        presetId: "preset",
        originalSizeMB: 1,
      } as any),
    ] as any);

    const filteredJobs = computed(() => jobs.value);

    const sortPrimary = ref("elapsed" as any);
    const sortPrimaryDirection = ref("desc" as any);
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
    expect(state?.displayModeSortedJobs.value.map((job) => job.id)).toEqual([
      "completed-slow",
      "completed-fallback",
      "completed-fast",
      "unfinished",
    ]);

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
