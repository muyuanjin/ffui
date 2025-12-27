// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computed, ref } from "vue";
import type { TranscodeJob, Translate } from "@/types";

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
}));

vi.mock("vue-sonner", () => ({
  toast: {
    info: toastMocks.info,
    success: toastMocks.success,
    error: toastMocks.error,
    message: toastMocks.message,
  },
}));

import { createQueueBulkActionsWithFeedback } from "./useMainAppQueue.bulkActions";

const makeJob = (id: string, status: TranscodeJob["status"]): TranscodeJob => ({
  id,
  filename: `C:/videos/${id}.mp4`,
  type: "video",
  source: "manual",
  originalSizeMB: 1,
  presetId: "preset-1",
  status,
  progress: 0,
});

const t: Translate = (key, params) => {
  if (!params) return key;
  const parts = Object.entries(params)
    .slice()
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${key}:${parts.join(",")}`;
};

describe("createQueueBulkActionsWithFeedback details report", () => {
  beforeEach(() => {
    toastMocks.info.mockReset();
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    toastMocks.message.mockReset();
  });

  it("attaches a details action that opens a report toast", async () => {
    const jobs = ref<TranscodeJob[]>([makeJob("job-paused", "paused"), makeJob("job-queued", "queued")]);
    const selectedJobIds = ref<Set<string>>(new Set(["job-paused", "job-queued"]));
    const selectedJobs = computed(() => jobs.value.filter((job) => selectedJobIds.value.has(job.id)));
    const queueError = ref<string | null>(null);

    const api = createQueueBulkActionsWithFeedback({
      t,
      jobs,
      selectedJobs,
      selectedJobIds,
      queueError,
      lastQueueSnapshotRevision: ref<number | null>(null),
      refreshQueueFromBackend: async () => {},
      bulkWaitSelectedJobs: async () => {},
      bulkResumeSelectedJobs: async () => {
        jobs.value = jobs.value.map((job) => (job.status === "paused" ? { ...job, status: "queued" } : job));
      },
      bulkRestartSelectedJobs: async () => {},
      bulkCancelSelectedJobs: async () => {},
      bulkMoveSelectedJobsToTopInner: async () => {},
      bulkMoveSelectedJobsToBottomInner: async () => {},
    });

    await api.bulkResume();

    expect(toastMocks.success).toHaveBeenCalledTimes(1);
    const [title, opts] = toastMocks.success.mock.calls[0] ?? [];
    expect(title).toBe("queue.feedback.bulkResume.successTitle");
    expect(opts?.description).toContain("selected=2");
    expect(opts?.description).toContain("count=1");
    expect(opts?.description).toContain("ignored=1");
    expect(opts?.action?.label).toBe("queue.feedback.report.action");

    opts?.action?.onClick?.();
    expect(toastMocks.message).toHaveBeenCalledTimes(1);
    const [reportTitle, reportOpts] = toastMocks.message.mock.calls[0] ?? [];
    expect(reportTitle).toBe("queue.feedback.report.title");
    expect(reportOpts?.description).toContain("queue.feedback.report.selected:count=2");
    expect(reportOpts?.description).toContain("queue.feedback.report.before");
    expect(reportOpts?.description).toContain("queue.feedback.report.after");
    expect(reportOpts?.description).toContain("queue.status.paused");
    expect(reportOpts?.description).toContain("queue.status.queued: 2");
  });
});
