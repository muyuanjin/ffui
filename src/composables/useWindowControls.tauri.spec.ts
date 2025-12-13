// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, it, expect, vi } from "vitest";

const toggleMaximize = vi.fn(async () => {});
const isMaximized = vi.fn(async () => false);
const maximize = vi.fn(async () => {});
const unmaximize = vi.fn(async () => {});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(async () => ({
    toggleMaximize,
    isMaximized,
    maximize,
    unmaximize,
    minimize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  })),
}));

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
}));

import { useWindowControls } from "./useWindowControls";

describe("useWindowControls (tauri maximize)", () => {
  it("uses window.toggleMaximize() so it matches the configured Tauri window capability", async () => {
    let controls: ReturnType<typeof useWindowControls> | null = null;

    const TestComp = {
      setup() {
        controls = useWindowControls();
        return () => null;
      },
    };

    const wrapper = mount(TestComp);
    await nextTick();

    await controls!.toggleMaximizeWindow();

    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(isMaximized).not.toHaveBeenCalled();
    expect(maximize).not.toHaveBeenCalled();
    expect(unmaximize).not.toHaveBeenCalled();

    await wrapper.unmount();
  });
});
