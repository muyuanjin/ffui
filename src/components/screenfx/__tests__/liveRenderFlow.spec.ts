// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startLiveRenderFlow } from "@/components/screenfx/liveRenderFlow";

describe("startLiveRenderFlow", () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();

    window.matchMedia = ((query: string) => {
      return {
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      };
    }) as any;

    window.requestAnimationFrame = (() => 1) as any;
    window.cancelAnimationFrame = (() => {}) as any;

    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancel;
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("spawns a text row + image row for processing jobs", () => {
    const textWorld = document.createElement("div");
    const imageWorld = document.createElement("div");

    const cleanup = startLiveRenderFlow({
      textWorld,
      imageWorld,
      getJobs: () =>
        [
          {
            status: "processing",
            filename: "clip.mp4",
            ffmpegCommand: 'ffmpeg -i "clip.mp4" -c:v libx264 -crf 23 -y out.mp4',
          },
        ] as any,
    });

    vi.advanceTimersByTime(220);

    const code = textWorld.querySelector(".ffui-screenfx-code") as HTMLElement | null;
    expect(code).not.toBeNull();
    expect(code?.innerHTML).toContain("ffmpeg");

    const img = imageWorld.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/ffui.svg");

    cleanup();

    expect(textWorld.childElementCount).toBe(0);
    expect(imageWorld.childElementCount).toBe(0);
  });

  it("still renders when prefers-reduced-motion is enabled", () => {
    window.matchMedia = ((query: string) => {
      return {
        matches: true,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      };
    }) as any;

    const textWorld = document.createElement("div");
    const imageWorld = document.createElement("div");

    const cleanup = startLiveRenderFlow({
      textWorld,
      imageWorld,
      getJobs: () =>
        [
          {
            status: "processing",
            filename: "clip.mp4",
            ffmpegCommand: 'ffmpeg -i "clip.mp4" -c:v libx264 -crf 23 -y out.mp4',
          },
        ] as any,
    });

    vi.advanceTimersByTime(220);
    expect(textWorld.querySelector(".ffui-screenfx-code")).not.toBeNull();
    expect(imageWorld.querySelector("img")).not.toBeNull();

    cleanup();
  });
});
