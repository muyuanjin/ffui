// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";

describe("installAppSettingsCloseFlush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("still closes the window when persistNow never resolves", async () => {
    await vi.resetModules();

    const close = vi.fn(async () => {});
    let closeRequestedHandler: ((event: { preventDefault: () => void }) => Promise<void>) | null = null;

    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: async () => ({
        onCloseRequested: async (handler: any) => {
          closeRequestedHandler = handler;
          return () => {
            if (closeRequestedHandler === handler) {
              closeRequestedHandler = null;
            }
          };
        },
        close,
      }),
    }));

    const persistNow = vi.fn(() => new Promise<void>(() => {}));
    const { installAppSettingsCloseFlush } = await import("@/composables/useAppSettingsCloseFlush");

    const TestHarness = defineComponent({
      setup() {
        installAppSettingsCloseFlush({ enabled: () => true, persistNow });
        return {};
      },
      template: "<div />",
    });

    const wrapper = mount(TestHarness);
    await Promise.resolve();
    await Promise.resolve();

    expect(typeof closeRequestedHandler).toBe("function");

    const preventDefault = vi.fn();
    const handlerPromise = (closeRequestedHandler as any)({ preventDefault });

    // Test env uses a short timeout (see CLOSE_FLUSH_TIMEOUT_MS).
    await vi.advanceTimersByTimeAsync(60);
    await handlerPromise;

    expect(preventDefault).toHaveBeenCalled();
    expect(persistNow).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
