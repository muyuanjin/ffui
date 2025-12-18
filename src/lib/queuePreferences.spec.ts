// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueMode, QueueProgressStyle, QueueViewMode } from "@/types";
import {
  QUEUE_PROGRESS_STYLE_STORAGE_KEY,
  QUEUE_VIEW_MODE_STORAGE_KEY,
  QUEUE_MODE_STORAGE_KEY,
} from "./queuePreferences";

const loadModule = async () => {
  // Reload the module so that internal singleton state (initialized flag)
  // is reset between tests.
  vi.resetModules();
  // eslint-disable-next-line import/no-relative-packages
  return import("./queuePreferences");
};

const setStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

describe("useQueuePreferences", () => {
  it("uses defaults when storage is empty", async () => {
    const { useQueuePreferences } = await loadModule();
    const { queueViewMode, queueProgressStyle, queueMode, defaults } = useQueuePreferences();

    expect(queueViewMode.value).toBe<QueueViewMode>(defaults.viewMode);
    expect(queueProgressStyle.value).toBe<QueueProgressStyle>(defaults.progressStyle);
    expect(queueMode.value).toBe<QueueMode>(defaults.mode);
  });

  it("reads view mode and progress style from storage when available", async () => {
    setStorage(QUEUE_VIEW_MODE_STORAGE_KEY, "compact");
    setStorage(QUEUE_PROGRESS_STYLE_STORAGE_KEY, "card-fill");
    setStorage(QUEUE_MODE_STORAGE_KEY, "queue");

    const { useQueuePreferences } = await loadModule();
    const { queueViewMode, queueProgressStyle, queueMode } = useQueuePreferences();

    expect(queueViewMode.value).toBe<QueueViewMode>("compact");
    expect(queueProgressStyle.value).toBe<QueueProgressStyle>("card-fill");
    expect(queueMode.value).toBe<QueueMode>("queue");
  });

  it("falls back to defaults when storage contains invalid values", async () => {
    setStorage(QUEUE_VIEW_MODE_STORAGE_KEY, "unknown-mode");
    setStorage(QUEUE_PROGRESS_STYLE_STORAGE_KEY, "weird-style");
    setStorage(QUEUE_MODE_STORAGE_KEY, "strange-mode");

    const { useQueuePreferences } = await loadModule();
    const { queueViewMode, queueProgressStyle, queueMode, defaults } = useQueuePreferences();

    expect(queueViewMode.value).toBe<QueueViewMode>(defaults.viewMode);
    expect(queueProgressStyle.value).toBe<QueueProgressStyle>(defaults.progressStyle);
    expect(queueMode.value).toBe<QueueMode>(defaults.mode);
  });

  it("persists changes back to storage when setters are called", async () => {
    const { useQueuePreferences } = await loadModule();
    const { queueViewMode, queueProgressStyle, queueMode, setQueueViewMode, setQueueProgressStyle, setQueueMode } =
      useQueuePreferences();

    setQueueViewMode("compact");
    setQueueProgressStyle("card-fill");
    setQueueMode("queue");

    expect(queueViewMode.value).toBe<QueueViewMode>("compact");
    expect(queueProgressStyle.value).toBe<QueueProgressStyle>("card-fill");
    expect(queueMode.value).toBe<QueueMode>("queue");

    if (typeof window !== "undefined") {
      expect(window.localStorage.getItem(QUEUE_VIEW_MODE_STORAGE_KEY)).toBe("compact");
      expect(window.localStorage.getItem(QUEUE_PROGRESS_STYLE_STORAGE_KEY)).toBe("card-fill");
      expect(window.localStorage.getItem(QUEUE_MODE_STORAGE_KEY)).toBe("queue");
    }
  });

  it("handles environments without usable localStorage by keeping defaults", async () => {
    if (typeof window === "undefined") {
      // Nothing to verify in non-DOM environments.
      return;
    }

    const originalLocalStorage = window.localStorage;

    // Simulate an environment where localStorage is not available or throws.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage unavailable");
      },
    });

    const { useQueuePreferences } = await loadModule();
    const { queueViewMode, queueProgressStyle, queueMode, defaults } = useQueuePreferences();

    expect(queueViewMode.value).toBe<QueueViewMode>(defaults.viewMode);
    expect(queueProgressStyle.value).toBe<QueueProgressStyle>(defaults.progressStyle);
    expect(queueMode.value).toBe<QueueMode>(defaults.mode);

    // Restore the original localStorage for subsequent tests.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });
});
