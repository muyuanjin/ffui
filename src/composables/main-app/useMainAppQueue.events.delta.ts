import type { QueueStateLiteDelta } from "@/types";

type QueueDeltaPatch = QueueStateLiteDelta["patches"][number];
type QueueDeltaPatchEntry = { rev: number; patch: QueueDeltaPatch };
export type QueueDeltaFrame = { rev: number; patches: QueueStateLiteDelta["patches"] | null | undefined };

export function mergeQueueDeltaPatchInto(existing: QueueDeltaPatch, incoming: QueueDeltaPatch): void {
  if (existing.id !== incoming.id) return;
  const incomingAny = incoming as unknown as Record<string, unknown>;
  const existingAny = existing as unknown as Record<string, unknown>;
  for (const key of Object.keys(incomingAny)) {
    if (key === "id" || incomingAny[key] === undefined) continue;
    existingAny[key] = incomingAny[key];
  }
}

export function mergeQueueDeltaPatches(
  patchesById: Map<string, QueueDeltaPatchEntry>,
  patches: QueueStateLiteDelta["patches"] | null | undefined,
  rev: number,
): void {
  if (!Array.isArray(patches)) return;
  for (const patch of patches) {
    const id = patch?.id;
    if (!id) continue;
    const existing = patchesById.get(id);
    if (!existing) {
      patchesById.set(id, { rev, patch });
      continue;
    }
    if (rev < existing.rev) continue;
    mergeQueueDeltaPatchInto(existing.patch, patch);
    if (rev > existing.rev) {
      existing.rev = rev;
    }
  }
}

export function coalesceQueueDeltaFrames(
  frames: readonly QueueDeltaFrame[],
  minRevisionExclusive: number,
): { deltaRevision: number | null; patches: QueueStateLiteDelta["patches"] } {
  const patchesById = new Map<string, QueueDeltaPatchEntry>();
  let deltaRevision: number | null = null;

  for (const frame of frames) {
    const rev = frame?.rev;
    if (typeof rev !== "number" || !Number.isFinite(rev)) continue;
    if (rev <= minRevisionExclusive) continue;
    mergeQueueDeltaPatches(patchesById, frame.patches, rev);
    deltaRevision = deltaRevision == null ? rev : Math.max(deltaRevision, rev);
  }

  return {
    deltaRevision,
    patches: Array.from(patchesById.values()).map((entry) => entry.patch),
  };
}
