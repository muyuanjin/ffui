// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import type { TranscodeJob } from "@/types";
import { createQueueForegroundRefreshController } from "./useMainAppQueue.events.foreground";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createQueueForegroundRefreshController", () => {
  it("cleans up async Tauri focus subscriptions that resolve after unmount", async () => {
    const jobs = ref<TranscodeJob[]>([
      {
        id: "job-1",
        filename: "C:/videos/progress.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 100,
        presetId: "preset-1",
        status: "processing",
        progress: 10,
      },
    ]);
    const focusDeferred = createDeferred<() => void>();
    const blurDeferred = createDeferred<() => void>();
    const focusUnlisten = vi.fn();
    const blurUnlisten = vi.fn();
    const refreshQueueFromBackend = vi.fn(async () => {});
    const handlers: {
      focus?: () => void | Promise<void>;
      blur?: () => void | Promise<void>;
    } = {};

    const controller = createQueueForegroundRefreshController({
      jobs,
      lastQueueSnapshotAtMs: ref<number | null>(null),
      refreshQueueFromBackend,
      hasPendingAheadDelta: () => false,
      flushPendingQueueState: () => {},
      flushPendingQueueDelta: () => {},
      flushPendingAheadDeltaIfReady: () => {},
      subscribeWindowFocus: async (handler) => {
        handlers.focus = handler;
        return focusDeferred.promise;
      },
      subscribeWindowBlur: async (handler) => {
        handlers.blur = handler;
        return blurDeferred.promise;
      },
    });

    controller.mount();
    controller.unmount();

    expect(handlers.focus).toBeTypeOf("function");
    expect(handlers.blur).toBeTypeOf("function");
    handlers.focus?.();
    handlers.blur?.();

    expect(refreshQueueFromBackend).not.toHaveBeenCalled();

    focusDeferred.resolve(focusUnlisten);
    blurDeferred.resolve(blurUnlisten);
    await Promise.all([focusDeferred.promise, blurDeferred.promise]);
    await Promise.resolve();

    expect(focusUnlisten).toHaveBeenCalledTimes(1);
    expect(blurUnlisten).toHaveBeenCalledTimes(1);
  });

  it("logs and consumes rejected async Tauri focus subscriptions", async () => {
    const focusError = new Error("focus listener failed");
    const blurError = new Error("blur listener failed");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const controller = createQueueForegroundRefreshController({
        jobs: ref<TranscodeJob[]>([]),
        lastQueueSnapshotAtMs: ref<number | null>(null),
        refreshQueueFromBackend: vi.fn(async () => {}),
        hasPendingAheadDelta: () => false,
        flushPendingQueueState: () => {},
        flushPendingQueueDelta: () => {},
        flushPendingAheadDeltaIfReady: () => {},
        subscribeWindowFocus: async () => {
          throw focusError;
        },
        subscribeWindowBlur: async () => {
          throw blurError;
        },
      });

      controller.mount();
      await flushMicrotasks();

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to register queue window focus listener:", focusError);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to register queue window blur listener:", blurError);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
