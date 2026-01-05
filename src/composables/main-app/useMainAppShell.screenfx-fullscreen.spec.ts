// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/backend", () => ({
  hasTauri: () => false,
  acknowledgeTaskbarProgress: vi.fn(async () => {}),
}));

vi.mock("@/composables", () => ({
  useWindowControls: () => ({
    minimizeWindow: vi.fn(async () => {}),
    toggleMaximizeWindow: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
  }),
}));

import { useMainAppShell } from "./useMainAppShell";

describe("useMainAppShell (screen fx fullscreen exit)", () => {
  const originalExitFullscreen = (document as any).exitFullscreen;
  const originalFullscreenElementDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");

  afterEach(() => {
    if (originalFullscreenElementDescriptor) {
      Object.defineProperty(document, "fullscreenElement", originalFullscreenElementDescriptor);
    } else {
      delete (document as any).fullscreenElement;
    }
    (document as any).exitFullscreen = originalExitFullscreen;
  });

  it("exits fullscreen when closing screen fx", async () => {
    let fullscreenElement: Element | null = document.documentElement;
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    (document as any).exitFullscreen = exitFullscreen;

    let shell: ReturnType<typeof useMainAppShell> | null = null;
    const TestComp = {
      setup() {
        shell = useMainAppShell();
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();

    shell!.toggleScreenFx(); // open
    fullscreenElement = document.documentElement;
    shell!.toggleScreenFx(); // close => exit fullscreen

    expect(exitFullscreen).toHaveBeenCalledTimes(1);

    await wrapper.unmount();
  });

  it("does not attempt to exit fullscreen when not fullscreen", async () => {
    let fullscreenElement: Element | null = null;
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
    });

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    (document as any).exitFullscreen = exitFullscreen;

    let shell: ReturnType<typeof useMainAppShell> | null = null;
    const TestComp = {
      setup() {
        shell = useMainAppShell();
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();

    shell!.toggleScreenFx(); // open
    shell!.toggleScreenFx(); // close

    expect(exitFullscreen).toHaveBeenCalledTimes(0);

    await wrapper.unmount();
  });
});
