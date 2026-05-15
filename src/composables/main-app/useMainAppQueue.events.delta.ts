import type { QueueStateLiteDelta } from "@/types";

type QueueDeltaPatch = QueueStateLiteDelta["patches"][number];
type QueueDeltaPatchEntry = { rev: number; patch: QueueDeltaPatch };
type QueueDeltaMailboxPatchEntry = { patch: QueueDeltaPatch; fieldRevisions: Map<string, number> };
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

export class QueueDeltaLatestWinsMailbox {
  private baseSnapshotRevision: number | null = null;
  private patchesById = new Map<string, QueueDeltaMailboxPatchEntry>();

  get baseRevision(): number | null {
    return this.baseSnapshotRevision;
  }

  get size(): number {
    return this.patchesById.size;
  }

  get isEmpty(): boolean {
    return this.patchesById.size === 0 || this.baseSnapshotRevision == null;
  }

  clear(): void {
    this.baseSnapshotRevision = null;
    this.patchesById.clear();
  }

  push(
    baseSnapshotRevision: number,
    deltaRevision: number,
    patches: QueueStateLiteDelta["patches"] | null | undefined,
    minRevisionExclusive: number,
  ): void {
    if (deltaRevision <= minRevisionExclusive) return;
    if (this.baseSnapshotRevision !== baseSnapshotRevision) {
      this.clear();
      this.baseSnapshotRevision = baseSnapshotRevision;
    }
    if (!Array.isArray(patches)) return;
    for (const patch of patches) {
      const id = patch?.id;
      if (!id) continue;
      let existing = this.patchesById.get(id);
      if (!existing) {
        existing = { patch: { id }, fieldRevisions: new Map() };
        this.patchesById.set(id, existing);
      }

      const incomingAny = patch as unknown as Record<string, unknown>;
      const existingAny = existing.patch as unknown as Record<string, unknown>;
      for (const key of Object.keys(incomingAny)) {
        if (key === "id" || incomingAny[key] === undefined) continue;
        const prevRevision = existing.fieldRevisions.get(key);
        if (prevRevision != null && deltaRevision < prevRevision) continue;
        existingAny[key] = incomingAny[key];
        existing.fieldRevisions.set(key, deltaRevision);
      }
    }
  }

  drain(minRevisionExclusive: number): {
    baseSnapshotRevision: number | null;
    deltaRevision: number | null;
    patches: QueueStateLiteDelta["patches"];
  } {
    const baseSnapshotRevision = this.baseSnapshotRevision;
    if (baseSnapshotRevision == null) {
      return { baseSnapshotRevision: null, deltaRevision: null, patches: [] };
    }

    let deltaRevision: number | null = null;
    const patches: QueueStateLiteDelta["patches"] = [];

    for (const entry of this.patchesById.values()) {
      const patch: QueueDeltaPatch = { id: entry.patch.id };
      const patchAny = patch as unknown as Record<string, unknown>;
      const sourceAny = entry.patch as unknown as Record<string, unknown>;

      for (const [key, rev] of entry.fieldRevisions.entries()) {
        if (rev <= minRevisionExclusive) continue;
        patchAny[key] = sourceAny[key];
        deltaRevision = deltaRevision == null ? rev : Math.max(deltaRevision, rev);
      }

      if (Object.keys(patchAny).length > 1) {
        patches.push(patch);
      }
    }

    this.clear();
    return { baseSnapshotRevision, deltaRevision, patches };
  }
}
