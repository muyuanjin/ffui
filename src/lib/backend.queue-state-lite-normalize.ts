import type { QueueStateLite } from "@/types/queue";

export const normalizeQueueStateLiteWaitMetadata = (state: QueueStateLite): QueueStateLite => {
  for (const job of state.jobs ?? []) {
    const status = (job as unknown as { status?: unknown }).status;
    if (status === "waiting") {
      (job as unknown as { status: unknown }).status = "queued";
    }

    const meta = job.waitMetadata;
    if (!meta) continue;

    // QueueStateLite is a UI-facing snapshot. Crash-recovery internals such as
    // segment paths are intentionally excluded to keep startup payloads small
    // and avoid retaining large arrays in the renderer process.
    meta.segments = undefined;
    meta.segmentEndTargets = undefined;
  }

  return state;
};
