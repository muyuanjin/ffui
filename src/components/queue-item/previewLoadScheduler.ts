type Task = { run: () => void | Promise<void> };

const highPriorityKeys: string[] = [];
const normalPriorityKeys: string[] = [];
const queuedKeySet = new Set<string>();
const taskByKey = new Map<string, Task>();

let scheduled = false;
let inFlightHigh = 0;
let inFlightNormal = 0;

const MAX_TOTAL_IN_FLIGHT = 2;
const MAX_NORMAL_IN_FLIGHT_WITH_QUEUED_HIGH = 1;

type IdleDeadlineLike = { timeRemaining: () => number; didTimeout?: boolean };

const schedulePump = () => {
  if (scheduled) return;
  scheduled = true;

  if (typeof window !== "undefined") {
    const w = window as unknown as {
      requestIdleCallback?: (cb: (deadline: IdleDeadlineLike) => void, opts?: { timeout?: number }) => number;
      requestAnimationFrame?: (cb: () => void) => number;
    };

    // High-priority tasks should render promptly after view switches/unmounts.
    // Run them on the next animation frame instead of waiting for idle time.
    if (highPriorityKeys.length > 0 && typeof w.requestAnimationFrame === "function") {
      w.requestAnimationFrame(() => pump());
      return;
    }

    if (typeof w.requestIdleCallback === "function") {
      // Use a timeout safety net so previews do not starve forever on platforms
      // where `requestIdleCallback` rarely fires (or always reports near-zero
      // budget). The work itself is still gated by higher-level "scrolling"
      // hints, so we avoid doing it during active interactions.
      w.requestIdleCallback((deadline) => pump(deadline), { timeout: 1200 });
      return;
    }

    if (typeof w.requestAnimationFrame === "function") {
      w.requestAnimationFrame(() => pump());
      return;
    }
    window.setTimeout(() => pump(), 0);
    return;
  }

  void Promise.resolve().then(() => pump());
};

const pump = (_deadline?: IdleDeadlineLike) => {
  scheduled = false;

  const startNext = (priority: "high" | "normal"): boolean => {
    const totalInFlight = inFlightHigh + inFlightNormal;
    if (totalInFlight >= MAX_TOTAL_IN_FLIGHT) return false;
    if (
      priority === "normal" &&
      highPriorityKeys.length > 0 &&
      inFlightNormal >= MAX_NORMAL_IN_FLIGHT_WITH_QUEUED_HIGH
    ) {
      return false;
    }

    const queue = priority === "high" ? highPriorityKeys : normalPriorityKeys;
    const key = queue.shift();
    if (!key) return false;
    queuedKeySet.delete(key);

    const task = taskByKey.get(key);
    taskByKey.delete(key);
    if (!task) return true;

    try {
      const result = task.run();
      if (result && typeof (result as Promise<void>).then === "function") {
        if (priority === "high") {
          inFlightHigh += 1;
        } else {
          inFlightNormal += 1;
        }
        void (result as Promise<void>)
          .catch(() => {})
          .finally(() => {
            if (priority === "high") {
              inFlightHigh = Math.max(0, inFlightHigh - 1);
            } else {
              inFlightNormal = Math.max(0, inFlightNormal - 1);
            }
            pump();
          });
      }
    } catch {
      // ignore
    }

    return true;
  };

  let startedHigh = startNext("high");
  while (startedHigh) {
    startedHigh = startNext("high");
  }

  let startedNormal = startNext("normal");
  while (startedNormal) {
    startedNormal = startNext("normal");
  }
};

export function schedulePreviewLoad(
  key: string,
  run: () => void | Promise<void>,
  opts?: { priority?: "high" | "normal" },
): () => void {
  if (!key) return () => {};
  const priority = opts?.priority ?? "normal";
  taskByKey.set(key, { run });
  if (!queuedKeySet.has(key)) {
    queuedKeySet.add(key);
    (priority === "high" ? highPriorityKeys : normalPriorityKeys).push(key);
  } else if (priority === "high") {
    // Starvation guard: if a key becomes urgent again (e.g. remount after view mode
    // switch), bump it to the front so visible/blank previews fill promptly.
    const idxNormal = normalPriorityKeys.indexOf(key);
    if (idxNormal >= 0) normalPriorityKeys.splice(idxNormal, 1);
    const idxHigh = highPriorityKeys.indexOf(key);
    if (idxHigh >= 0) highPriorityKeys.splice(idxHigh, 1);
    highPriorityKeys.unshift(key);
  }
  schedulePump();

  return () => {
    taskByKey.delete(key);
    if (!queuedKeySet.has(key)) return;
    queuedKeySet.delete(key);
    const idxHigh = highPriorityKeys.indexOf(key);
    if (idxHigh >= 0) highPriorityKeys.splice(idxHigh, 1);
    const idxNormal = normalPriorityKeys.indexOf(key);
    if (idxNormal >= 0) normalPriorityKeys.splice(idxNormal, 1);
  };
}

export function resetPreviewLoadSchedulerForTests() {
  highPriorityKeys.length = 0;
  normalPriorityKeys.length = 0;
  queuedKeySet.clear();
  taskByKey.clear();
  scheduled = false;
  inFlightHigh = 0;
  inFlightNormal = 0;
}
