import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { TranscodeJob } from "@/types";
import { useJobLog } from "./useJobLog";

const backend = vi.hoisted(() => ({ hasTauri: vi.fn(() => true), loadJobDetail: vi.fn() }));
vi.mock("@/lib/backend", () => backend);

const job = (id: string): TranscodeJob => ({
  id,
  filename: `${id}.wav`,
  type: "audio",
  source: "manual",
  originalSizeMB: 1,
  presetId: "audio",
  status: "completed",
  progress: 100,
  logs: [],
});
const scopes: ReturnType<typeof effectScope>[] = [];
const setup = (initialJob = job("first")) => {
  const selectedJob = ref<TranscodeJob | null>(initialJob);
  const detailOpen = ref(true);
  const scope = effectScope();
  scopes.push(scope);
  const logs = scope.run(() => useJobLog({ selectedJob, detailOpen }))!;
  return { selectedJob, detailOpen, logs };
};

describe("job detail log loading", () => {
  beforeEach(() => {
    backend.hasTauri.mockReturnValue(true);
    backend.loadJobDetail.mockReset();
  });
  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop());
    vi.useRealTimers();
  });

  it.each([
    ["completed", "success"],
    ["completed", "failure"],
    ["failed", "success"],
    ["failed", "failure"],
  ] as const)("refreshes %s logs after an in-flight %s snapshot settles", async (status, outcome) => {
    vi.useFakeTimers();
    const processingJob = { ...job("first"), status: "processing" as const, progress: 50 };
    const staleDetail = { ...processingJob, runs: [{ command: "ffmpeg first", logs: ["start", "last progress"] }] };
    const finalDetail = {
      ...processingJob,
      status,
      runs: [
        { command: "ffmpeg first", logs: ["start", "last progress"] },
        { command: "ffmpeg retry", logs: ["FINAL STDERR"] },
      ],
    };
    let resolveRead!: (detail: TranscodeJob) => void;
    let rejectRead!: (error: Error) => void;
    backend.loadJobDetail
      .mockResolvedValueOnce(processingJob)
      .mockImplementationOnce(
        () =>
          new Promise<TranscodeJob>((resolve, reject) => {
            resolveRead = resolve;
            rejectRead = reject;
          }),
      )
      .mockResolvedValue(finalDetail);
    const { selectedJob, logs } = setup(processingJob);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(2);
    const retry = logs.retryJobDetailLog();
    selectedJob.value = { ...processingJob, status, progress: 100 };
    await nextTick();
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(2);
    if (outcome === "success") resolveRead(staleDetail);
    else rejectRead(new Error("stale read failed"));
    await retry;
    await flushPromises();
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(3);
    expect(logs.jobDetailJob.value?.status).toBe(status);
    expect(logs.jobDetailJob.value?.runs).toEqual(finalDetail.runs);
    expect(logs.jobDetailLogText.value).toBe("start\nlast progress\nFINAL STDERR");
    expect(logs.jobDetailLogLoaded.value).toBe(true);
    expect(logs.jobDetailLogLoading.value).toBe(false);
    expect(logs.jobDetailLogError.value).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(3);
  });

  it("reports rejected reads, retries terminal jobs on reopen, and clears the error after success", async () => {
    backend.loadJobDetail.mockRejectedValue(new Error("transport denied"));
    const { logs, detailOpen } = setup();
    await flushPromises();
    expect(logs.jobDetailLogError.value).toBe("transport denied");
    expect(logs.jobDetailLogLoaded.value).toBe(false);
    expect(logs.jobDetailLogLoading.value).toBe(false);
    detailOpen.value = false;
    await nextTick();
    backend.loadJobDetail.mockResolvedValue({ ...job("first"), logs: ["recovered"] });
    detailOpen.value = true;
    await flushPromises();
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(2);
    expect(logs.jobDetailLogText.value).toBe("recovered");
    expect(logs.jobDetailLogError.value).toBeNull();
    expect(logs.jobDetailLogLoaded.value).toBe(true);
  });

  it.each(["close", "switch"] as const)("does not refresh an obsolete job after detail %s", async (action) => {
    const liveJob = { ...job("first"), status: "processing" as const };
    let resolveRead!: (detail: TranscodeJob) => void;
    backend.loadJobDetail
      .mockImplementationOnce(
        () =>
          new Promise<TranscodeJob>((resolve) => {
            resolveRead = resolve;
          }),
      )
      .mockResolvedValue({ ...job("second"), logs: ["second log"] });
    const { selectedJob, detailOpen, logs } = setup(liveJob);
    await flushPromises();
    selectedJob.value = job("first");
    await nextTick();
    if (action === "close") detailOpen.value = false;
    else selectedJob.value = job("second");
    await flushPromises();
    resolveRead({ ...liveJob, logs: ["stale first log"] });
    await flushPromises();
    expect(backend.loadJobDetail.mock.calls.filter(([id]) => id === "first")).toHaveLength(1);
    if (action === "switch") expect(logs.jobDetailLogText.value).toBe("second log");
  });

  it.each([
    ["completed", "success", "reopen"],
    ["completed", "failure", "reopen"],
    ["failed", "success", "reopen"],
    ["failed", "failure", "reopen"],
    ["completed", "success", "reselect"],
    ["completed", "failure", "reselect"],
    ["failed", "success", "reselect"],
    ["failed", "failure", "reselect"],
  ] as const)("refreshes %s logs after a stale %s read and %s", async (status, outcome, action) => {
    const liveJob = { ...job("first"), status: "processing" as const };
    let resolveRead!: (detail: TranscodeJob) => void;
    let rejectRead!: (error: Error) => void;
    const finalDetail = {
      ...job("first"),
      status,
      runs: [
        { command: "ffmpeg first", logs: ["start"] },
        { command: "ffmpeg retry", logs: ["FINAL STDERR"] },
      ],
    };
    backend.loadJobDetail
      .mockImplementationOnce(
        () =>
          new Promise<TranscodeJob>((resolve, reject) => {
            resolveRead = resolve;
            rejectRead = reject;
          }),
      )
      .mockImplementation((id: string) => Promise.resolve(id === "first" ? finalDetail : job(id)));
    const { selectedJob, detailOpen, logs } = setup(liveJob);
    await flushPromises();
    if (action === "reselect") {
      selectedJob.value = job("second");
      await flushPromises();
      selectedJob.value = { ...job("first"), status };
    } else {
      detailOpen.value = false;
      await nextTick();
      selectedJob.value = { ...job("first"), status };
      await nextTick();
      detailOpen.value = true;
    }
    await nextTick();
    expect(backend.loadJobDetail.mock.calls.filter(([id]) => id === "first")).toHaveLength(1);
    if (outcome === "success") resolveRead({ ...liveJob, runs: [{ command: "ffmpeg first", logs: ["start"] }] });
    else rejectRead(new Error("stale read failed"));
    await flushPromises();
    expect(backend.loadJobDetail.mock.calls.filter(([id]) => id === "first")).toHaveLength(2);
    expect(logs.jobDetailLogText.value).toBe("start\nFINAL STDERR");
    expect(logs.jobDetailLogLoaded.value).toBe(true);
    expect(logs.jobDetailLogError.value).toBeNull();
  });

  it("keeps a failed final refresh visible and retryable without automatically retrying it", async () => {
    const liveJob = { ...job("first"), status: "processing" as const };
    let resolveRead!: (detail: TranscodeJob) => void;
    backend.loadJobDetail
      .mockImplementationOnce(
        () =>
          new Promise<TranscodeJob>((resolve) => {
            resolveRead = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("final read failed"))
      .mockResolvedValue({ ...job("first"), logs: ["FINAL STDERR"] });
    const { selectedJob, logs } = setup(liveJob);
    await flushPromises();
    selectedJob.value = { ...job("first"), status: "failed" };
    await nextTick();
    resolveRead({ ...liveJob, logs: ["stale first log"] });
    await flushPromises();
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(2);
    expect(logs.jobDetailLogError.value).toBe("final read failed");
    expect(logs.jobDetailLogLoaded.value).toBe(false);
    await logs.retryJobDetailLog();
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(3);
    expect(logs.jobDetailLogText.value).toBe("FINAL STDERR");
    expect(logs.jobDetailLogError.value).toBeNull();
  });

  it("distinguishes a successful empty log from a missing detail response", async () => {
    backend.loadJobDetail.mockResolvedValue(null);
    const { logs } = setup();
    await flushPromises();
    expect(logs.jobDetailLogError.value).toContain("unavailable");
    expect(logs.jobDetailLogLoaded.value).toBe(false);
    backend.loadJobDetail.mockResolvedValue(job("first"));
    await logs.retryJobDetailLog();
    expect(logs.jobDetailLogError.value).toBeNull();
    expect(logs.jobDetailLogLoaded.value).toBe(true);
    expect(logs.jobDetailLogText.value).toBe("");
  });

  it("deduplicates pending reads and keeps a previous job failure out of the current selection", async () => {
    let rejectFirst!: (error: Error) => void;
    backend.loadJobDetail.mockImplementation((id: string) =>
      id === "first"
        ? new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
        : Promise.resolve({ ...job(id), logs: ["second log"] }),
    );
    const { logs, selectedJob } = setup();
    expect(logs.jobDetailLogLoading.value).toBe(true);
    const retry = logs.retryJobDetailLog();
    await nextTick();
    expect(backend.loadJobDetail).toHaveBeenCalledTimes(1);
    selectedJob.value = job("second");
    await flushPromises();
    rejectFirst(new Error("old failure"));
    await retry;
    expect(logs.jobDetailLogError.value).toBeNull();
    expect(logs.jobDetailLogText.value).toBe("second log");
    expect(logs.jobDetailLogLoading.value).toBe(false);
  });

  it("reports a read that throws before returning a promise", async () => {
    backend.loadJobDetail.mockImplementation(() => {
      throw new Error("read setup failed");
    });
    const { logs } = setup();
    await flushPromises();
    expect(logs.jobDetailLogError.value).toBe("read setup failed");
    expect(logs.jobDetailLogLoading.value).toBe(false);
    expect(logs.jobDetailLogLoaded.value).toBe(false);
  });
});
