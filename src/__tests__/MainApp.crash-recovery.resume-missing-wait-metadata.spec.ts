// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import { emitQueueState, i18n, setQueueJobs, useBackendMock } from "./helpers/mainAppTauriDialog";
import MainApp from "@/MainApp.vue";

function getJobsFromVm(vm: any): TranscodeJob[] {
  const ref = vm.jobs;
  if (Array.isArray(ref)) return ref;
  if (ref && Array.isArray(ref.value)) return ref.value;
  return [];
}

async function flushQueuedQueueStateApply() {
  await nextTick();
  await new Promise((r) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => r(null));
    } else {
      setTimeout(r, 0);
    }
  });
  await nextTick();
}

describe("MainApp crash-recovery resume (missing waitMetadata)", () => {
  it("allows resuming a paused job even when waitMetadata is absent, then accepts recovered segments from backend snapshot", async () => {
    const jobId = "job-1766587734267";
    const pausedJob: TranscodeJob = {
      id: jobId,
      filename: "F:/videos/in.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "preset-1",
      status: "paused",
      progress: 35,
      outputPath: "F:/out/FC2-2319995-20251224-224859.mkv",
      // waitMetadata intentionally missing (force-kill timing / crash recovery gap)
    };

    setQueueJobs([pausedJob]);

    useBackendMock({
      resume_transcode_job: () => {
        setQueueJobs([{ ...pausedJob, status: "queued" }]);
        return true;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    await vm.refreshQueueFromBackend();
    await nextTick();

    emitQueueState([pausedJob]);
    await flushQueuedQueueStateApply();
    expect(getJobsFromVm(vm).find((j) => j.id === jobId)?.status).toBe("paused");

    await vm.handleResumeJob(jobId);
    await nextTick();
    expect(getJobsFromVm(vm).find((j) => j.id === jobId)?.status).toBe("queued");

    // Backend later sends a snapshot with recovered waitMetadata.segments.
    emitQueueState([
      {
        ...pausedJob,
        status: "queued",
        waitMetadata: {
          segments: ["F:/out/FC2-2319995-20251224-224859.job-1766587734267.seg0.tmp.mkv"],
          tmpOutputPath: "F:/out/FC2-2319995-20251224-224859.job-1766587734267.seg0.tmp.mkv",
          lastProgressPercent: 35,
        },
      } satisfies TranscodeJob,
    ]);
    await flushQueuedQueueStateApply();

    const updated = getJobsFromVm(vm).find((j) => j.id === jobId);
    expect(updated?.waitMetadata?.segments).toEqual([
      "F:/out/FC2-2319995-20251224-224859.job-1766587734267.seg0.tmp.mkv",
    ]);
    expect(updated?.waitMetadata?.tmpOutputPath).toBe(
      "F:/out/FC2-2319995-20251224-224859.job-1766587734267.seg0.tmp.mkv",
    );
  });
});
