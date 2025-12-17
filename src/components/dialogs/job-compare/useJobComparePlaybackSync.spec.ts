// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { computed, ref } from "vue";
import { useJobComparePlaybackSync } from "./useJobComparePlaybackSync";

describe("useJobComparePlaybackSync", () => {
  it("retries seeking until video metadata is available", async () => {
    vi.useFakeTimers();

    const video = document.createElement("video");
    let sets = 0;
    let time = 0;

    Object.defineProperty(video, "readyState", { configurable: true, get: () => 0 });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => time,
      set: (v) => {
        time = Number(v);
        sets += 1;
      },
    });

    const sync = useJobComparePlaybackSync({
      isPlaying: ref(false),
      maxCompareSeconds: computed(() => 0),
      timeline: ref([0]),
      getSideVideos: () => [video],
      getMasterVideo: () => video,
    });

    sync.seekVideos(5);
    expect(sets).toBe(0);

    Object.defineProperty(video, "readyState", { configurable: true, get: () => 1 });
    video.dispatchEvent(new Event("loadedmetadata"));

    await vi.runOnlyPendingTimersAsync();
    expect(sets).toBe(1);
    expect(time).toBe(5);

    vi.useRealTimers();
  });
});

