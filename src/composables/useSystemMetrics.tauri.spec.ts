// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { SystemMetricsSnapshot } from "@/types";

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
  metricsSubscribe: vi.fn(async () => {
    // Simulate the backend emitting a snapshot immediately after subscribe.
    const payload: SystemMetricsSnapshot = {
      timestamp: Date.now(),
      uptimeSeconds: 123,
      cpu: { cores: [10], total: 10 },
      memory: { usedBytes: 1, totalBytes: 2 },
      disk: { io: [] },
      network: { interfaces: [] },
      gpu: undefined,
    } as any;
    metricsHandler?.({ payload } as any);
  }),
  metricsUnsubscribe: vi.fn(async () => {}),
  fetchMetricsHistory: vi.fn(async () => []),
}));

import { useSystemMetrics } from "./useSystemMetrics";
import * as backend from "@/lib/backend";

describe("useSystemMetrics (tauri mode)", () => {
  beforeEach(() => {
    metricsHandler = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not miss the first snapshot emitted right after subscribe()", async () => {
    let hook: ReturnType<typeof useSystemMetrics> | null = null;

    const TestComp = {
      setup() {
        hook = useSystemMetrics({ historyLimit: 10 });
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();
    // Allow async subscribe/listen to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(backend.metricsSubscribe)).toHaveBeenCalled();
    expect(vi.mocked((await import("@tauri-apps/api/event")).listen)).toHaveBeenCalled();
    expect(hook!.snapshots.value.length).toBeGreaterThanOrEqual(1);

    await wrapper.unmount();
  });

  it("installs the event listener before calling metricsSubscribe()", async () => {
    const callOrder: string[] = [];

    vi.mocked(backend.metricsSubscribe).mockImplementationOnce(async () => {
      callOrder.push("subscribe");
      const payload: SystemMetricsSnapshot = {
        timestamp: Date.now(),
        uptimeSeconds: 123,
        cpu: { cores: [10], total: 10 },
        memory: { usedBytes: 1, totalBytes: 2 },
        disk: { io: [] },
        network: { interfaces: [] },
        gpu: undefined,
      } as any;
      metricsHandler?.({ payload } as any);
    });

    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockImplementationOnce(async (_event: string, handler: any) => {
      callOrder.push("listen");
      metricsHandler = handler;
      return () => {
        metricsHandler = null;
      };
    });

    const TestComp = {
      setup() {
        useSystemMetrics({ historyLimit: 10 });
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOrder[0]).toBe("listen");
    expect(callOrder).toContain("subscribe");

    await wrapper.unmount();
  });
});
