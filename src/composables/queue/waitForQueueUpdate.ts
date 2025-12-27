import { watch, type Ref } from "vue";

const isTestEnv =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined" &&
  (import.meta.env as { MODE?: string }).MODE === "test";

const DEFAULT_TIMEOUT_MS = isTestEnv ? 50 : 1_500;

async function waitForRefChange<T>(
  source: Ref<T>,
  shouldResolve: (next: T) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const safeTimeoutMs = Math.max(0, timeoutMs);
  if (safeTimeoutMs === 0) return false;

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      resolve(value);
    };

    const stop = watch(
      source,
      (next) => {
        if (settled) return;
        if (!shouldResolve(next)) return;
        stop();
        settle(true);
      },
      { flush: "post" },
    );

    timeoutId = setTimeout(() => {
      if (settled) return;
      stop();
      settle(false);
    }, safeTimeoutMs);

    if (timeoutId && typeof (timeoutId as unknown as { unref?: () => void }).unref === "function") {
      (timeoutId as unknown as { unref: () => void }).unref();
    }
  });
}

export async function waitForQueueUpdate(
  lastQueueSnapshotAtMs: Ref<number | null>,
  options?: { sinceMs?: number | null; timeoutMs?: number },
): Promise<boolean> {
  const sinceMs = options?.sinceMs ?? lastQueueSnapshotAtMs.value;
  const timeoutMs = Math.max(0, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return await waitForRefChange(
    lastQueueSnapshotAtMs,
    (next) => typeof next === "number" && Number.isFinite(next) && next !== sinceMs,
    timeoutMs,
  );
}

export async function waitForQueueSnapshotRevision(
  lastQueueSnapshotRevision: Ref<number | null>,
  options?: { sinceRevision?: number | null; timeoutMs?: number },
): Promise<boolean> {
  const sinceRevision = options?.sinceRevision ?? lastQueueSnapshotRevision.value;
  const timeoutMs = Math.max(0, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return await waitForRefChange(
    lastQueueSnapshotRevision,
    (next) => {
      if (typeof next !== "number" || !Number.isFinite(next)) return false;
      if (typeof sinceRevision === "number" && Number.isFinite(sinceRevision) && next <= sinceRevision) return false;
      return true;
    },
    timeoutMs,
  );
}
