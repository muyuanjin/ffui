// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import ScreenFxOverlay from "@/components/screenfx/ScreenFxOverlay.vue";

describe("ScreenFxOverlay", () => {
  it("shows idle FX when there is no processing job", () => {
    const wrapper = mount(ScreenFxOverlay, {
      props: {
        open: true,
        jobs: [{ status: "queued" }] as any,
        toggleOpen: () => {},
        toggleFullscreen: async () => {},
      },
      global: {
        stubs: {
          teleport: true,
          ScreenFxIdle: { template: "<div data-testid='idle' />" },
          ScreenFxLive: { template: "<div data-testid='live' />" },
        },
      },
    });

    expect(wrapper.find("[aria-label='screen-fx-overlay']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='idle']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='live']").exists()).toBe(false);
  });

  it("shows live FX when a job is processing", () => {
    const wrapper = mount(ScreenFxOverlay, {
      props: {
        open: true,
        jobs: [{ status: "processing" }, { status: "done" }] as any,
        toggleOpen: () => {},
        toggleFullscreen: async () => {},
      },
      global: {
        stubs: {
          teleport: true,
          ScreenFxIdle: { template: "<div data-testid='idle' />" },
          ScreenFxLive: { template: "<div data-testid='live' />" },
        },
      },
    });

    expect(wrapper.find("[data-testid='live']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='idle']").exists()).toBe(false);
  });

  it("calls toggleFullscreen when pressing F11 while open", async () => {
    const toggleFullscreen = vi.fn(async () => {});
    const wrapper = mount(ScreenFxOverlay, {
      props: {
        open: true,
        jobs: [],
        toggleOpen: () => {},
        toggleFullscreen,
      },
      global: {
        stubs: {
          teleport: true,
          ScreenFxIdle: { template: "<div data-testid='idle' />" },
          ScreenFxLive: { template: "<div data-testid='live' />" },
        },
      },
    });

    const event = new KeyboardEvent("keydown", { key: "F11", cancelable: true });
    window.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not call toggleFullscreen when not open", async () => {
    const toggleFullscreen = vi.fn(async () => {});
    const wrapper = mount(ScreenFxOverlay, {
      props: {
        open: false,
        jobs: [],
        toggleOpen: () => {},
        toggleFullscreen,
      },
      global: {
        stubs: {
          teleport: true,
          ScreenFxIdle: { template: "<div data-testid='idle' />" },
          ScreenFxLive: { template: "<div data-testid='live' />" },
        },
      },
    });

    const event = new KeyboardEvent("keydown", { key: "F11", cancelable: true });
    window.dispatchEvent(event);
    await wrapper.vm.$nextTick();

    expect(toggleFullscreen).toHaveBeenCalledTimes(0);
    expect(event.defaultPrevented).toBe(true);
  });
});
