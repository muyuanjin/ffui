// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { ref, nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import { useJobProgress } from "./useJobProgress";

describe("useJobProgress header progress", () => {
  it("tracks progress immediately without animation lag", async () => {
    const jobs = ref<TranscodeJob[]>([
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "processing",
        progress: 0,
        logs: [],
      } as TranscodeJob,
    ]);

    const appSettings = ref<any>({
      progressUpdateIntervalMs: 250,
      taskbarProgressMode: "byEstimatedTime",
      taskbarProgressScope: "allJobs",
    });
    const queueStructureRevision = ref<number | null>(1);

    const { headerProgressPercent, headerProgressVisible } = useJobProgress({
      jobs,
      queueStructureRevision,
      appSettings,
    });

    await nextTick();
    expect(headerProgressVisible.value).toBe(false);
    expect(headerProgressPercent.value).toBe(0);

    jobs.value[0]!.progress = 1;
    await nextTick();
    expect(headerProgressVisible.value).toBe(true);

    jobs.value[0]!.progress = 10;
    jobs.value[0]!.progress = 20;
    await nextTick();

    expect(headerProgressPercent.value).toBe(20);
  });

  it("can be disabled via titlebarProgressEnabled", async () => {
    const jobs = ref<TranscodeJob[]>([
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        presetId: "preset-1",
        status: "processing",
        progress: 10,
        logs: [],
      } as TranscodeJob,
    ]);

    const appSettings = ref<any>({
      titlebarProgressEnabled: false,
      progressUpdateIntervalMs: 250,
      taskbarProgressMode: "byEstimatedTime",
      taskbarProgressScope: "allJobs",
    });
    const queueStructureRevision = ref<number | null>(1);

    const { headerProgressPercent, headerProgressVisible } = useJobProgress({
      jobs,
      queueStructureRevision,
      appSettings,
    });

    await nextTick();
    expect(headerProgressVisible.value).toBe(false);
    expect(headerProgressPercent.value).toBe(0);

    jobs.value[0]!.progress = 30;
    await nextTick();
    expect(headerProgressVisible.value).toBe(false);
    expect(headerProgressPercent.value).toBe(0);
  });
});
