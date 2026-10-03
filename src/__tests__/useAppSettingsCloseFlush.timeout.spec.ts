// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";

describe("installAppSettingsCloseFlush", () => {
  it("prevents duplicate close events and delegates closure without calling window close or destroy", async () => {
    await vi.resetModules();
    const nativeClose = vi.fn();
    const destroy = vi.fn();
    let handler!: (event: { preventDefault: () => void }) => Promise<void>;
    const unlisten = vi.fn();
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        onCloseRequested: async (callback: typeof handler) => {
          handler = callback;
          return unlisten;
        },
        close: nativeClose,
        destroy,
      }),
    }));
    let finish!: () => void;
    const persistNow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const closeWindow = vi.fn(async () => {});
    const { installAppSettingsCloseFlush } = await import("@/composables/useAppSettingsCloseFlush");
    let cleanup!: () => void;
    const wrapper = mount(
      defineComponent({
        setup() {
          ({ cleanup } = installAppSettingsCloseFlush({
            enabled: () => true,
            persistNow,
            closeWindow,
            onFlushError: vi.fn(),
          }));
          return {};
        },
        template: "<div />",
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    const preventDefault = vi.fn();
    const first = handler({ preventDefault });
    await handler({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(persistNow).toHaveBeenCalledTimes(1);
    expect(closeWindow).not.toHaveBeenCalled();
    finish();
    await first;
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(nativeClose).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    cleanup();
    expect(unlisten).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["timeout", "rejection"])(
    "keeps the window open after a flush %s and allows another close attempt",
    async (failure) => {
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

      const persistNow = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() =>
          failure === "timeout" ? new Promise<void>(() => {}) : Promise.reject(new Error("atomic replacement denied")),
        )
        .mockResolvedValue(undefined);
      const onFlushError = vi.fn();
      const { installAppSettingsCloseFlush } = await import("@/composables/useAppSettingsCloseFlush");

      const TestHarness = defineComponent({
        setup() {
          installAppSettingsCloseFlush({ enabled: () => true, persistNow, closeWindow: close, onFlushError });
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
      expect(close).not.toHaveBeenCalled();
      expect(onFlushError).toHaveBeenCalledTimes(1);
      expect(onFlushError.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ message: failure === "timeout" ? "timeout" : "atomic replacement denied" }),
      );
      await (closeRequestedHandler as any)({ preventDefault });
      expect(close).toHaveBeenCalledTimes(1);
      expect(persistNow).toHaveBeenCalledTimes(2);

      wrapper.unmount();
    },
  );
});
