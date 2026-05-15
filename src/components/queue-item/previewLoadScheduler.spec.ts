// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPreviewLoadSchedulerForTests, schedulePreviewLoad } from "./previewLoadScheduler";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

type RunState = {
  inFlight: number;
  maxInFlight: number;
  started: string[];
  deferredByKey: Map<string, Deferred>;
};

const createDeferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const flushScheduler = async () => {
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
  await Promise.resolve();
};

const scheduleBlockingTask = (state: RunState, key: string, priority: "high" | "normal") => {
  const deferred = createDeferred();
  state.deferredByKey.set(key, deferred);
  schedulePreviewLoad(
    key,
    async () => {
      state.started.push(key);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await deferred.promise;
      state.inFlight -= 1;
    },
    { priority },
  );
};

describe("previewLoadScheduler", () => {
  const originalRequestIdleCallback = (window as any).requestIdleCallback;
  const originalCancelIdleCallback = (window as any).cancelIdleCallback;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    (window as any).requestIdleCallback = undefined;
    (window as any).cancelIdleCallback = undefined;
    (window as any).requestAnimationFrame = undefined;
    resetPreviewLoadSchedulerForTests();
  });

  afterEach(() => {
    (window as any).requestIdleCallback = originalRequestIdleCallback;
    (window as any).cancelIdleCallback = originalCancelIdleCallback;
    if (originalRequestAnimationFrame) {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete (window as any).requestAnimationFrame;
    }
    vi.useRealTimers();
  });

  it("uses both slots for normal work when no high-priority load is queued", async () => {
    const state: RunState = {
      inFlight: 0,
      maxInFlight: 0,
      started: [],
      deferredByKey: new Map(),
    };

    scheduleBlockingTask(state, "normal-1", "normal");
    scheduleBlockingTask(state, "normal-2", "normal");
    scheduleBlockingTask(state, "normal-3", "normal");

    await flushScheduler();

    expect(state.started).toEqual(["normal-1", "normal-2"]);
    expect(state.maxInFlight).toBe(2);

    state.deferredByKey.get("normal-1")?.resolve();
    await flushScheduler();
    expect(state.started).toEqual(["normal-1", "normal-2", "normal-3"]);

    state.deferredByKey.get("normal-2")?.resolve();
    state.deferredByKey.get("normal-3")?.resolve();
    await flushScheduler();
  });

  it("uses both slots for high-priority work when no normal load is queued", async () => {
    const state: RunState = {
      inFlight: 0,
      maxInFlight: 0,
      started: [],
      deferredByKey: new Map(),
    };

    scheduleBlockingTask(state, "high-1", "high");
    scheduleBlockingTask(state, "high-2", "high");
    scheduleBlockingTask(state, "high-3", "high");

    await flushScheduler();

    expect(state.started).toEqual(["high-1", "high-2"]);
    expect(state.maxInFlight).toBe(2);

    state.deferredByKey.get("high-1")?.resolve();
    await flushScheduler();
    expect(state.started).toEqual(["high-1", "high-2", "high-3"]);

    state.deferredByKey.get("high-2")?.resolve();
    state.deferredByKey.get("high-3")?.resolve();
    await flushScheduler();
  });

  it("starts queued high-priority work before filling the second slot with another normal task", async () => {
    const state: RunState = {
      inFlight: 0,
      maxInFlight: 0,
      started: [],
      deferredByKey: new Map(),
    };

    scheduleBlockingTask(state, "normal-1", "normal");
    scheduleBlockingTask(state, "normal-2", "normal");
    scheduleBlockingTask(state, "high-1", "high");

    await flushScheduler();

    expect(state.started).toEqual(["high-1", "normal-1"]);
    expect(state.maxInFlight).toBe(2);

    state.deferredByKey.get("high-1")?.resolve();
    await flushScheduler();
    expect(state.started).toEqual(["high-1", "normal-1", "normal-2"]);

    state.deferredByKey.get("normal-1")?.resolve();
    state.deferredByKey.get("normal-2")?.resolve();
    await flushScheduler();
  });
});
