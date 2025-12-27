// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref } from "vue";
import type { TranscodeJob } from "@/types";
import { createBulkDelete } from "./useMainAppQueue.bulkDelete";

const hasTauriMock = vi.fn<() => boolean>(() => true);
const deleteTranscodeJobsBulkMock = vi.fn<(jobIds: string[]) => Promise<boolean>>(async () => true);
const deleteBatchCompressBatchesBulkMock = vi.fn<(batchIds: string[]) => Promise<boolean>>(async () => true);

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => hasTauriMock(),
    deleteTranscodeJobsBulk: (jobIds: string[]) => deleteTranscodeJobsBulkMock(jobIds),
    deleteBatchCompressBatchesBulk: (batchIds: string[]) => deleteBatchCompressBatchesBulkMock(batchIds),
  };
});

describe("createBulkDelete", () => {
  beforeEach(() => {
    hasTauriMock.mockReset();
    deleteTranscodeJobsBulkMock.mockReset();
    deleteBatchCompressBatchesBulkMock.mockReset();
  });

  it("uses backend bulk delete commands for terminal jobs and full Batch Compress batches", async () => {
    hasTauriMock.mockReturnValue(true);

    const jobA = { id: "job-a", status: "completed", batchId: null } as unknown as TranscodeJob;
    const jobB = { id: "job-b", status: "failed", batchId: "batch-1" } as unknown as TranscodeJob;
    const jobC = { id: "job-c", status: "skipped", batchId: "batch-1" } as unknown as TranscodeJob;

    const jobs = ref<TranscodeJob[]>([jobA, jobB, jobC]);
    const selectedJobIds = ref(new Set<string>([jobA.id, jobB.id, jobC.id]));
    const selectedJobs = computed(() => jobs.value.filter((job) => selectedJobIds.value.has(job.id)));
    const queueError = ref<string | null>(null);
    const refreshQueueFromBackend = vi.fn(async () => {});
    const t = (key: string) => key;

    const bulkDelete = createBulkDelete({
      jobs,
      selectedJobIds,
      selectedJobs: selectedJobs as any,
      queueError,
      refreshQueueFromBackend,
      t,
    });

    await bulkDelete();

    expect(deleteBatchCompressBatchesBulkMock).toHaveBeenCalledTimes(1);
    expect(deleteBatchCompressBatchesBulkMock).toHaveBeenCalledWith(["batch-1"]);

    expect(deleteTranscodeJobsBulkMock).toHaveBeenCalledTimes(1);
    expect(deleteTranscodeJobsBulkMock).toHaveBeenCalledWith(["job-a"]);

    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
    expect(queueError.value).toBeNull();
    expect(Array.from(selectedJobIds.value)).toEqual([]);
  });
});
