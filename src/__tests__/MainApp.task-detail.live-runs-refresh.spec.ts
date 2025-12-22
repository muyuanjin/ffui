// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { TranscodeJob } from "@/types";
import {
  defaultAppSettings,
  emitQueueState,
  getQueueJobs,
  i18n,
  setQueueJobs,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import MainApp from "@/MainApp.vue";

function getRefValue<T>(maybeRef: any): T {
  if (maybeRef && typeof maybeRef === "object" && "value" in maybeRef) return maybeRef.value as T;
  return maybeRef as T;
}

function getJobsFromVm(vm: any): TranscodeJob[] {
  const jobs = getRefValue<unknown>(vm.jobs);
  return Array.isArray(jobs) ? (jobs as TranscodeJob[]) : [];
}

describe("MainApp task detail - live refresh for multi-run logs", () => {
  it("keeps refreshing backend job detail while the dialog is open so new runs/logs appear after pause/resume", async () => {
    vi.useFakeTimers();

    const jobId = "job-detail-live-1";
    setQueueJobs([
      {
        id: jobId,
        filename: "C:/videos/live-detail.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "preset-1",
        status: "processing",
        progress: 10,
        logs: [],
      } as TranscodeJob,
    ]);

    let runsCount = 1;

    useBackendMock({
      get_queue_state: () => ({ jobs: getQueueJobs() }),
      get_queue_state_lite: () => ({ jobs: getQueueJobs() }),
      get_app_settings: () => defaultAppSettings(),
      get_job_detail: (payload) => {
        expect(payload?.jobId ?? payload?.job_id).toBe(jobId);
        const base = getQueueJobs()[0] as TranscodeJob;
        return {
          ...base,
          runs: Array.from({ length: runsCount }, (_v, idx) => ({
            command: `ffmpeg run ${idx + 1}`,
            logs: [`command: ffmpeg run ${idx + 1}`, `run${idx + 1}-log-line`],
          })),
        } satisfies TranscodeJob;
      },
    });

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;

    await nextTick();
    await vm.refreshQueueFromBackend();
    await nextTick();

    const job = getJobsFromVm(vm).find((j) => j.id === jobId) as TranscodeJob | undefined;
    expect(job).toBeTruthy();

    vm.dialogManager.openJobDetail(job as TranscodeJob);
    await nextTick();

    // First hydrate should load Run 1 logs.
    await Promise.resolve();
    await nextTick();

    const detail0 = getRefValue<TranscodeJob | null>(vm.jobDetailJob);
    expect(detail0?.runs?.length).toBe(1);
    expect(getRefValue<string>(vm.jobDetailLogText)).toContain("run1-log-line");

    // Simulate a pause/resume cycle that produces another run on the backend.
    setQueueJobs([{ ...getQueueJobs()[0], status: "paused", progress: 25 } as TranscodeJob]);
    emitQueueState(getQueueJobs());
    await nextTick();

    setQueueJobs([{ ...getQueueJobs()[0], status: "processing", progress: 30 } as TranscodeJob]);
    emitQueueState(getQueueJobs());
    await nextTick();

    runsCount = 2;

    // After one poll tick, task detail should include Run 2 logs.
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await nextTick();

    const detail1 = getRefValue<TranscodeJob | null>(vm.jobDetailJob);
    expect(detail1?.runs?.length).toBe(2);
    expect(getRefValue<string>(vm.jobDetailLogText)).toContain("run2-log-line");

    wrapper.unmount();
    vi.useRealTimers();
  });
});
