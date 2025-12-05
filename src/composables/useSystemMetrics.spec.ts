// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock Tauri event API so we don't depend on a real runtime.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Force useSystemMetrics into "web-only" mode so it uses the mock metrics
// generator. We still provide stubs for the Tauri commands to keep type
// checking happy.
vi.mock("@/lib/backend", () => ({
  hasTauri: () => false,
  metricsSubscribe: vi.fn(),
  metricsUnsubscribe: vi.fn(),
  fetchMetricsHistory: vi.fn().mockResolvedValue([]),
}));

import { useSystemMetrics } from "./useSystemMetrics";

describe("useSystemMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("maintains bounded history and stable series under a long stream", async () => {
    let hook: ReturnType<typeof useSystemMetrics> | null = null;

    const TestComp = {
      setup() {
        hook = useSystemMetrics({
          historyLimit: 5,
          mockIntervalMs: 100,
        });
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();

    // Simulate a long-running metrics stream.
    await vi.advanceTimersByTimeAsync(5_000);

    const metrics = hook!;
    const { snapshots, cpuTotalSeries, memorySeries, diskSeries, networkSeries } =
      metrics;

    expect(snapshots.value.length).toBeGreaterThan(0);
    expect(snapshots.value.length).toBeLessThanOrEqual(5);

    // Derived series should be kept in sync with the underlying history.
    expect(cpuTotalSeries.value.length).toBe(snapshots.value.length);
    expect(memorySeries.value.length).toBe(snapshots.value.length);
    expect(diskSeries.value.length).toBe(snapshots.value.length);

    // Network series groups points by interface name.
    const totalNetworkPoints = networkSeries.value.reduce(
      (sum, iface) => sum + iface.values.length,
      0,
    );
    expect(totalNetworkPoints).toBe(snapshots.value.length);

    await wrapper.unmount();
  });

  it("cleans up timers on stop / unmount to avoid leaks", async () => {
    let hook: ReturnType<typeof useSystemMetrics> | null = null;

    const TestComp = {
      setup() {
        hook = useSystemMetrics({
          historyLimit: 3,
          mockIntervalMs: 100,
        });
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();

    await vi.advanceTimersByTimeAsync(1_000);

    const metrics = hook!;
    const initialCount = metrics.snapshots.value.length;
    expect(initialCount).toBeGreaterThan(0);

    await wrapper.unmount();

    // After unmounting, advancing fake timers should no longer grow history.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(metrics.snapshots.value.length).toBe(initialCount);
  });
});
