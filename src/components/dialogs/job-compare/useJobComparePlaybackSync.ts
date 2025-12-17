import { ref, type ComputedRef, type Ref } from "vue";

type PlaybackSyncHandle =
  | { kind: "raf"; id: number }
  | { kind: "rvfc"; video: HTMLVideoElement; id: number };

type SeekHandle = { kind: "raf"; id: number } | { kind: "timeout"; id: number };

const seekVideoIfNeeded = (video: HTMLVideoElement, seconds: number) => {
  const epsilon = 1 / 120;
  const current = Number.isFinite(video.currentTime) ? video.currentTime : null;
  if (current != null && Math.abs(current - seconds) <= epsilon) return;
  video.currentTime = seconds;
};

type SeekRetryState = {
  seconds: number;
  attempts: number;
  timerId: number | null;
  onReady: () => void;
};

export function useJobComparePlaybackSync(options: {
  isPlaying: Ref<boolean>;
  maxCompareSeconds: ComputedRef<number>;
  timeline: Ref<number[]>;
  getSideVideos: (side: "input" | "output") => HTMLVideoElement[];
  getMasterVideo: () => HTMLVideoElement | null;
}) {
  const playbackSyncHandle = ref<PlaybackSyncHandle | null>(null);
  const seekHandle = ref<SeekHandle | null>(null);
  const pendingSeekSeconds = ref<number | null>(null);
  const seekRetry = new Map<HTMLVideoElement, SeekRetryState>();

  const clearPlaybackSync = () => {
    const handle = playbackSyncHandle.value;
    if (!handle) return;
    if (handle.kind === "raf") {
      window.cancelAnimationFrame(handle.id);
    } else {
      try {
        (handle.video as any).cancelVideoFrameCallback?.(handle.id);
      } catch {
        // ignore
      }
    }
    playbackSyncHandle.value = null;
  };

  const clearSeekRetryFor = (video: HTMLVideoElement) => {
    const state = seekRetry.get(video);
    if (!state) return;
    if (state.timerId != null) window.clearTimeout(state.timerId);
    try {
      video.removeEventListener("loadedmetadata", state.onReady);
      video.removeEventListener("canplay", state.onReady);
    } catch {
      // ignore
    }
    seekRetry.delete(video);
  };

  const scheduleSeekRetryFor = (video: HTMLVideoElement, seconds: number) => {
    clearSeekRetryFor(video);

    const state: SeekRetryState = {
      seconds,
      attempts: 0,
      timerId: null,
      onReady: () => {
        attemptSeek(video);
      },
    };
    seekRetry.set(video, state);
    try {
      video.addEventListener("loadedmetadata", state.onReady);
      video.addEventListener("canplay", state.onReady);
    } catch {
      // ignore
    }
    attemptSeek(video);
  };

  const attemptSeek = (video: HTMLVideoElement) => {
    const state = seekRetry.get(video);
    if (!state) return;

    if (!Number.isFinite(state.seconds) || state.seconds < 0) {
      clearSeekRetryFor(video);
      return;
    }

    // Some browsers throw before metadata is available; retry until readyState advances.
    const ready = Number.isFinite(video.readyState) ? video.readyState : 0;
    if (ready <= 0) {
      state.attempts += 1;
      if (state.attempts > 40) {
        clearSeekRetryFor(video);
        return;
      }
      state.timerId = window.setTimeout(() => attemptSeek(video), 50);
      return;
    }

    try {
      seekVideoIfNeeded(video, state.seconds);
      clearSeekRetryFor(video);
    } catch {
      state.attempts += 1;
      if (state.attempts > 40) {
        clearSeekRetryFor(video);
        return;
      }
      state.timerId = window.setTimeout(() => attemptSeek(video), 50);
    }
  };

  const clearPendingSeek = () => {
    const handle = seekHandle.value;
    if (!handle) return;
    if (handle.kind === "raf") window.cancelAnimationFrame(handle.id);
    else window.clearTimeout(handle.id);
    seekHandle.value = null;
    pendingSeekSeconds.value = null;
  };

  const resetOutputPlaybackRates = () => {
    for (const v of options.getSideVideos("output")) {
      try {
        v.playbackRate = 1;
      } catch {
        // ignore
      }
    }
  };

  const pauseVideos = () => {
    for (const v of [...options.getSideVideos("input"), ...options.getSideVideos("output")]) {
      try {
        v.pause();
      } catch {
        // ignore
      }
    }
  };

  const playVideos = async () => {
    for (const v of [...options.getSideVideos("input"), ...options.getSideVideos("output")]) {
      try {
        await v.play();
      } catch {
        // ignore
      }
    }
  };

  const stopPlayback = () => {
    options.isPlaying.value = false;
    clearPlaybackSync();
    pauseVideos();
    resetOutputPlaybackRates();
  };

  const seekVideos = (seconds: number) => {
    for (const v of [...options.getSideVideos("input"), ...options.getSideVideos("output")]) {
      scheduleSeekRetryFor(v, seconds);
    }
  };

  const scheduleSeekVideos = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    pendingSeekSeconds.value = seconds;
    if (seekHandle.value) return;

    const run = () => {
      const next = pendingSeekSeconds.value;
      pendingSeekSeconds.value = null;
      seekHandle.value = null;
      if (next == null) return;
      seekVideos(next);
    };

    if (typeof window.requestAnimationFrame === "function") {
      const id = window.requestAnimationFrame(run);
      seekHandle.value = { kind: "raf", id };
    } else {
      const id = window.setTimeout(run, 0);
      seekHandle.value = { kind: "timeout", id };
    }
  };

  const startPlaybackSync = () => {
    clearPlaybackSync();
    const master = options.getMasterVideo();
    if (!master) return;

    const softSyncSeconds = 0.02; // ~half frame @ 25fps
    const hardSyncSeconds = 0.08; // keep within ~2 frames @ 25fps
    const rateAdjustGain = 2.0;
    const maxRateAdjust = 0.12;

    const tick = (rawSeconds: number) => {
      if (!options.isPlaying.value) return;
      const max = options.maxCompareSeconds.value;
      const current = Number.isFinite(rawSeconds) ? rawSeconds : Number(master.currentTime ?? 0);
      const clamped = Number.isFinite(max) && max > 0 ? Math.min(current, max) : Math.max(current, 0);

      options.timeline.value = [clamped];

      if (Number.isFinite(max) && max > 0 && current >= max - 0.001) {
        stopPlayback();
        scheduleSeekVideos(max);
        return;
      }

      const masterRate = Number.isFinite(master.playbackRate) && master.playbackRate > 0 ? master.playbackRate : 1;
      const outputs = options.getSideVideos("output");
      for (const out of outputs) {
        const outSeconds = Number.isFinite(out.currentTime) ? out.currentTime : null;
        if (outSeconds == null) continue;
        const drift = outSeconds - clamped;
        if (!Number.isFinite(drift)) continue;

        if (Math.abs(drift) >= hardSyncSeconds) {
          try {
            seekVideoIfNeeded(out, clamped);
            out.playbackRate = masterRate;
          } catch {
            // ignore
          }
          continue;
        }

        const needsAdjust = Math.abs(drift) >= softSyncSeconds;
        const correction = needsAdjust ? (1 - drift * rateAdjustGain) : 1;
        const adjusted = Math.min(1 + maxRateAdjust, Math.max(1 - maxRateAdjust, correction));
        try {
          out.playbackRate = masterRate * adjusted;
        } catch {
          // ignore
        }

        if (!out.paused && !master.paused) continue;
        if (master.paused) continue;
        try {
          void out.play();
        } catch {
          // ignore
        }
      }
    };

    const supportsRvfc = typeof (master as any).requestVideoFrameCallback === "function";
    if (supportsRvfc) {
      const loop = () => {
        const id = (master as any).requestVideoFrameCallback((_now: number, meta: any) => {
          if (!options.isPlaying.value) return;
          const mediaTime = Number.isFinite(meta?.mediaTime) ? meta.mediaTime : master.currentTime;
          tick(mediaTime);
          if (options.isPlaying.value) loop();
        });
        playbackSyncHandle.value = { kind: "rvfc", video: master, id };
      };
      loop();
      return;
    }

    const loop = () => {
      const id = window.requestAnimationFrame(() => {
        if (!options.isPlaying.value) return;
        tick(master.currentTime);
        loop();
      });
      playbackSyncHandle.value = { kind: "raf", id };
    };
    loop();
  };

  const startPlaybackFrom = async (seconds: number) => {
    options.isPlaying.value = true;
    resetOutputPlaybackRates();
    clearPendingSeek();
    seekVideos(seconds);
    await playVideos();
    startPlaybackSync();
  };

  const togglePlay = async (seconds: number) => {
    if (options.isPlaying.value) {
      stopPlayback();
      clearPendingSeek();
      return;
    }
    await startPlaybackFrom(seconds);
  };

  const cleanup = () => {
    clearPlaybackSync();
    clearPendingSeek();
    for (const v of Array.from(seekRetry.keys())) clearSeekRetryFor(v);
  };

  return {
    togglePlay,
    startPlaybackFrom,
    stopPlayback,
    scheduleSeekVideos,
    seekVideos,
    clearPendingSeek,
    cleanup,
  };
}
