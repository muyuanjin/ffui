import type { QueueStateLite } from "@/types/queue";

export const normalizeQueueStateLiteWaitMetadata = (state: QueueStateLite): QueueStateLite => {
  for (const job of state.jobs ?? []) {
    const meta = job.waitMetadata;
    if (!meta) continue;

    const segments = meta.segments;
    const endTargets = meta.segmentEndTargets;
    if (!Array.isArray(endTargets)) continue;

    if (!Array.isArray(segments) || endTargets.length !== segments.length) {
      meta.segmentEndTargets = undefined;
      continue;
    }

    let prev = 0;
    for (const t of endTargets) {
      if (typeof t !== "number" || !Number.isFinite(t) || t <= prev) {
        meta.segmentEndTargets = undefined;
        break;
      }
      prev = t;
    }
  }

  return state;
};
