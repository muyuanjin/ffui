// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { scheduleStartupIdle } from "./startupIdle";

describe("scheduleStartupIdle", () => {
  it("uses requestIdleCallback with timeout when available", () => {
    const cb = vi.fn();
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();

    const win = {
      requestIdleCallback,
      setTimeout,
    } as unknown as Window & typeof globalThis;

    scheduleStartupIdle(cb, { timeoutMs: 123, win });

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).toHaveBeenCalledWith(cb, { timeout: 123 });
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("falls back to setTimeout(0) when requestIdleCallback is unavailable", () => {
    const cb = vi.fn();
    const setTimeout = vi.fn();

    const win = {
      setTimeout,
    } as unknown as Window & typeof globalThis;

    scheduleStartupIdle(cb, { timeoutMs: 123, win });

    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(cb, 0);
  });
});
