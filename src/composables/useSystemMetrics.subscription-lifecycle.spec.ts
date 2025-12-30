// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, it, expect, beforeEach, vi } from "vitest";

import type { SystemMetricsSnapshot } from "@/types";
import { resetTauriSubscriptionsForTests } from "@/lib/tauriSubscriptions";

let metricsHandler: ((event: { payload: SystemMetricsSnapshot }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: any }) => void) => {
    metricsHandler = handler as any;
    return () => {
      metricsHandler = null;
    };
  }),
}));

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  metricsSubscribe: vi.fn(async () => {}),
  metricsUnsubscribe: vi.fn(async () => {}),
  fetchMetricsHistory: vi.fn(async () => []),
}));

import { useSystemMetrics } from "./useSystemMetrics";

describe("useSystemMetrics subscription lifecycle", () => {
  beforeEach(() => {
    resetTauriSubscriptionsForTests();
    metricsHandler = null;
  });

  it("does not duplicate callbacks across mount/unmount cycles", async () => {
    let hookA: ReturnType<typeof useSystemMetrics> | null = null;
    let hookB: ReturnType<typeof useSystemMetrics> | null = null;

    const CompA = {
      setup() {
        hookA = useSystemMetrics({ historyLimit: 10 });
        return () => null;
      },
    };

    const wrapperA = mount(CompA);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshotA: SystemMetricsSnapshot = {
      timestamp: 1,
      uptimeSeconds: 1,
      cpu: { cores: [10], total: 10 },
      memory: { usedBytes: 1, totalBytes: 2 },
      disk: { io: [] },
      network: { interfaces: [] },
      gpu: undefined,
    } as any;

    metricsHandler?.({ payload: snapshotA } as any);
    expect(hookA!.snapshots.value.length).toBe(1);

    await wrapperA.unmount();

    metricsHandler?.({ payload: snapshotA } as any);
    expect(hookA!.snapshots.value.length).toBe(1);

    const CompB = {
      setup() {
        hookB = useSystemMetrics({ historyLimit: 10 });
        return () => null;
      },
    };

    const wrapperB = mount(CompB);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshotB: SystemMetricsSnapshot = { ...snapshotA, timestamp: 2 };
    metricsHandler?.({ payload: snapshotB } as any);

    expect(hookA!.snapshots.value.length).toBe(1);
    expect(hookB!.snapshots.value.length).toBe(1);

    await wrapperB.unmount();
  });
});
