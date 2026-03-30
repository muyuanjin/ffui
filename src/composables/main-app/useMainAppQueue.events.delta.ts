import type { QueueStateLiteDelta } from "@/types";

type QueueDeltaPatch = QueueStateLiteDelta["patches"][number];
type QueueDeltaPatchEntry = { rev: number; patch: QueueDeltaPatch };

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
  onAcceptedRevision: (nextRev: number) => void,
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
    if (rev <= existing.rev) continue;
    existing.rev = rev;
    onAcceptedRevision(rev);
  }
}
