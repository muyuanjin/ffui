// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { ref, nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import { useJobProgress, __test as jobProgressTest } from "./useJobProgress";

describe("useJobProgress perf", () => {
  it("does not rebuild aggregate on progress-only updates", async () => {
    const JOBS = 10_000;

    const processingJob: TranscodeJob = {
      id: "job-processing",
      filename: "C:/videos/p.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "processing",
      progress: 0,
      logs: [],
    };

    const queuedJobs: TranscodeJob[] = Array.from({ length: JOBS - 1 }, (_, idx) => ({
      id: `job-${idx}`,
      filename: `C:/videos/${idx}.mp4`,
      type: "video",
      source: "manual",
      originalSizeMB: 100,
      presetId: "preset-1",
      status: "queued",
      progress: 0,
      logs: [],
    }));

    const jobs = ref<TranscodeJob[]>([processingJob, ...queuedJobs]);
    const queueStructureRevision = ref<number | null>(1);
    const appSettings = ref<any>({
      progressUpdateIntervalMs: 250,
      taskbarProgressMode: "byEstimatedTime",
      taskbarProgressScope: "allJobs",
    });

    jobProgressTest.resetPerfCounters();

    const { globalTaskbarProgressPercent } = useJobProgress({ jobs, queueStructureRevision, appSettings });

    await nextTick();

    const initial = jobProgressTest.getPerfCounters();
    expect(initial.rebuildCalls).toBe(1);
    expect(initial.rebuildJobsScanned).toBe(JOBS);
    expect(initial.progressWatches).toBe(1);
    expect(globalTaskbarProgressPercent.value).not.toBeNull();

    jobs.value[0]!.progress = 50;
    await nextTick();

    const afterProgress = jobProgressTest.getPerfCounters();
    expect(afterProgress.rebuildCalls).toBe(1);
    expect(afterProgress.rebuildJobsScanned).toBe(JOBS);
    expect(afterProgress.progressWatchUpdates).toBeGreaterThanOrEqual(1);

    queueStructureRevision.value = 2;
    await nextTick();

    const afterRebuild = jobProgressTest.getPerfCounters();
    expect(afterRebuild.rebuildCalls).toBe(2);
  });
});
