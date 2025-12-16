<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { JobCompareOutput, JobCompareSources, TranscodeJob } from "@/types";
import {
  buildPlayableMediaUrl,
  getJobCompareSources,
  hasTauri,
} from "@/lib/backend";
import CompareViewport, { type CompareMode } from "./job-compare/CompareViewport.vue";
import { useJobCompareFrames } from "./job-compare/useJobCompareFrames";
const props = defineProps<{
  open: boolean;
  job: TranscodeJob | null;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
}>();
const { t } = useI18n();
const sources = ref<JobCompareSources | null>(null);
const sourcesError = ref<string | null>(null);
const loadingSources = ref(false);
const mode = ref<CompareMode>("side-by-side");
const timeline = ref<number[]>([0]);
const forceFrameCompare = ref(false);
const isPlaying = ref(false);
const playbackTimer = ref<number | null>(null);
const viewportRef = ref<InstanceType<typeof CompareViewport> | null>(null);
const jobRef = toRef(props, "job");
const openRef = toRef(props, "open");
const totalDurationSeconds = computed(() => {
  const d = props.job?.mediaInfo?.durationSeconds;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
});
const maxCompareSeconds = computed(() => {
  const reported = sources.value?.maxCompareSeconds;
  const maxFromSources =
    typeof reported === "number" && Number.isFinite(reported) && reported > 0 ? reported : null;
  const total = totalDurationSeconds.value;
  if (maxFromSources != null && total != null) return Math.min(maxFromSources, total);
  if (maxFromSources != null) return maxFromSources;
  return total ?? 0;
});
const clampedTimelineSeconds = computed(() => {
  const raw = timeline.value[0] ?? 0;
  const max = maxCompareSeconds.value;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return raw;
  return Math.min(raw, max);
});
watch(
  () => maxCompareSeconds.value,
  (max) => {
    if (!Number.isFinite(max) || max <= 0) return;
    if ((timeline.value[0] ?? 0) > max) {
      timeline.value = [max];
    }
  },
);
const compareLabel = computed(() => {
  const max = maxCompareSeconds.value;
  const total = totalDurationSeconds.value;
  if (!Number.isFinite(max) || max <= 0) return null;
  if (total != null && Number.isFinite(total) && total > 0 && max < total) {
    return `${formatTime(max)} / ${formatTime(total)}`;
  }
  return `${formatTime(max)}`;
});
const output = computed<JobCompareOutput | null>(() => sources.value?.output ?? null);
const inputPath = computed(() => sources.value?.inputPath ?? null);

const outputSinglePath = computed(() => {
  const o = output.value;
  if (!o) return null;
  if (o.kind === "completed") return o.outputPath;
  return o.activeSegmentPath || (o.segmentPaths.length === 1 ? o.segmentPaths[0] : null);
});

const playbackEligible = computed(() => {
  const o = output.value;
  if (!inputPath.value) return false;
  if (!o) return false;
  if (o.kind === "partial" && o.segmentPaths.length > 1 && !o.activeSegmentPath) return false;
  return !!outputSinglePath.value;
});
const usingFrameCompare = computed(() => forceFrameCompare.value || !playbackEligible.value);

const inputVideoUrl = computed(() => {
  if (!playbackEligible.value) return null;
  const path = inputPath.value;
  return path ? buildPlayableMediaUrl(path) : null;
});

const outputVideoUrl = computed(() => {
  if (!playbackEligible.value) return null;
  const path = outputSinglePath.value;
  return path ? buildPlayableMediaUrl(path) : null;
});
const clearPlaybackTimer = () => {
  if (playbackTimer.value != null) {
    window.clearInterval(playbackTimer.value);
    playbackTimer.value = null;
  }
};
const frames = useJobCompareFrames({
  open: openRef,
  job: jobRef,
  sources,
  totalDurationSeconds,
  clampedTimelineSeconds,
  usingFrameCompare,
});
const {
  inputFrameUrl,
  inputFrameLoading,
  inputFrameError,
  inputFrameQuality,
  outputFrameUrl,
  outputFrameLoading,
  outputFrameError,
  outputFrameQuality,
  clearFrameTimers,
  resetFrames,
  handleFrameImgError,
} = frames;
const getViewportEl = () => viewportRef.value?.getContainerEl?.() ?? null;
const getSideVideos = (side: "input" | "output") => {
  const el = getViewportEl();
  if (!el) return [] as HTMLVideoElement[];
  return Array.from(el.querySelectorAll(`video[data-compare-side="${side}"]`)) as HTMLVideoElement[];
};
const getMasterVideo = () => getSideVideos("input")[0] ?? null;
const seekVideos = (seconds: number) => {
  for (const v of [...getSideVideos("input"), ...getSideVideos("output")]) {
    try {
      v.currentTime = seconds;
    } catch {
      // ignore
    }
  }
};
const pauseVideos = () => {
  for (const v of [...getSideVideos("input"), ...getSideVideos("output")]) {
    try {
      v.pause();
    } catch {
      // ignore
    }
  }
};
const playVideos = async () => {
  for (const v of [...getSideVideos("input"), ...getSideVideos("output")]) {
    try {
      await v.play();
    } catch {
      // ignore
    }
  }
};

const startPlaybackSync = () => {
  clearPlaybackTimer();
  playbackTimer.value = window.setInterval(() => {
    if (!isPlaying.value) return;
    const master = getMasterVideo();
    if (!master) return;
    const max = maxCompareSeconds.value;
    const current = Number.isFinite(master.currentTime) ? master.currentTime : 0;
    const clamped = Number.isFinite(max) && max > 0 ? Math.min(current, max) : Math.max(current, 0);
    timeline.value = [clamped];

    const outputs = getSideVideos("output");
    for (const out of outputs) {
      const drift = Math.abs((out.currentTime ?? 0) - clamped);
      if (drift > 0.12) {
        try {
          out.currentTime = clamped;
        } catch {
          // ignore
        }
      }
    }
  }, 200);
};

const togglePlay = async () => {
  if (usingFrameCompare.value) return;
  if (isPlaying.value) {
    isPlaying.value = false;
    pauseVideos();
    clearPlaybackTimer();
    return;
  }
  isPlaying.value = true;
  seekVideos(clampedTimelineSeconds.value);
  await playVideos();
  startPlaybackSync();
};

const handleResetZoom = () => {
  viewportRef.value?.resetZoom?.();
};

const setTimeline = (value: number[] | undefined) => {
  timeline.value = value?.length ? value : [0];
};

const fetchSources = async () => {
  const job = props.job;
  if (!props.open || !job) return;
  if (!hasTauri()) {
    sources.value = null;
    sourcesError.value = t("jobCompare.requiresTauri") as string;
    return;
  }

  loadingSources.value = true;
  sourcesError.value = null;
  sources.value = null;
  forceFrameCompare.value = false;
  isPlaying.value = false;
  pauseVideos();
  clearPlaybackTimer();
  resetFrames();
  clearFrameTimers();

  try {
    const result = await getJobCompareSources(job.id);
    sources.value = result;
    if (!result) {
      sourcesError.value = t("jobCompare.unavailable") as string;
    }
  } catch (error) {
    sourcesError.value = (error as Error)?.message ?? String(error);
  } finally {
    loadingSources.value = false;
  }
};

watch(
  () => [props.open, props.job?.id] as const,
  () => void fetchSources(),
  { immediate: true },
);

watch(
  () => props.open,
  (open, prev) => {
    if (prev && !open) {
      clearPlaybackTimer();
      isPlaying.value = false;
      pauseVideos();
      clearFrameTimers();
    }
  },
);

watch(
  () => [usingFrameCompare.value, clampedTimelineSeconds.value] as const,
  ([frameMode, seconds]) => {
    if (frameMode) return;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    seekVideos(seconds);
  },
);

const handleNativeError = () => {
  forceFrameCompare.value = true;
  isPlaying.value = false;
  pauseVideos();
  clearPlaybackTimer();
};

onBeforeUnmount(() => {
  clearPlaybackTimer();
});

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const whole = Math.floor(seconds);
  const frac = seconds - whole;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base =
    h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (frac <= 0.001) return base;
  return `${base}.${Math.round(frac * 10)}`;
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle class="text-base">
          {{ props.job?.filename ? `${t("jobCompare.title")} · ${props.job.filename}` : t("jobCompare.title") }}
        </DialogTitle>
        <DialogDescription class="text-[11px] text-muted-foreground">
          {{ t("jobCompare.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <Button
            size="xs"
            :variant="mode === 'side-by-side' ? 'default' : 'outline'"
            data-testid="job-compare-mode-side-by-side"
            @click="mode = 'side-by-side'"
          >
            {{ t("jobCompare.modes.sideBySide") }}
          </Button>
          <Button
            size="xs"
            :variant="mode === 'wipe' ? 'default' : 'outline'"
            data-testid="job-compare-mode-wipe"
            @click="mode = 'wipe'"
          >
            {{ t("jobCompare.modes.wipe") }}
          </Button>
          <Button
            size="xs"
            :variant="mode === 'blink' ? 'default' : 'outline'"
            data-testid="job-compare-mode-blink"
            @click="mode = 'blink'"
          >
            {{ t("jobCompare.modes.blink") }}
          </Button>
        </div>

        <div class="flex items-center gap-2">
          <span
            v-if="compareLabel"
            class="text-[11px] text-muted-foreground"
            data-testid="job-compare-max-label"
            :title="String(t('jobCompare.maxLabelHint'))"
          >
            {{ compareLabel }}
          </span>

          <Button
            v-if="playbackEligible && !usingFrameCompare"
            size="xs"
            variant="outline"
            class="h-7"
            data-testid="job-compare-toggle-play"
            @click="togglePlay"
          >
            {{ isPlaying ? t("jobCompare.pause") : t("jobCompare.play") }}
          </Button>

          <Button size="xs" variant="outline" class="h-7" @click="handleResetZoom">
            {{ t("jobCompare.resetZoom") }}
          </Button>
        </div>
      </div>

      <div class="mt-3">
        <CompareViewport
          ref="viewportRef"
          :open="open"
          :mode="mode"
          :loading-sources="loadingSources"
          :sources-error="sourcesError"
          :using-frame-compare="usingFrameCompare"
          :input-video-url="inputVideoUrl"
          :output-video-url="outputVideoUrl"
          :input-frame-url="inputFrameUrl"
          :input-frame-loading="inputFrameLoading"
          :input-frame-error="inputFrameError"
          :input-frame-quality="inputFrameQuality"
          :output-frame-url="outputFrameUrl"
          :output-frame-loading="outputFrameLoading"
          :output-frame-error="outputFrameError"
          :output-frame-quality="outputFrameQuality"
          @frame-img-error="handleFrameImgError"
          @native-error="handleNativeError"
        />
      </div>

      <div class="mt-3">
        <div class="flex items-center justify-between text-[11px] text-muted-foreground">
          <span data-testid="job-compare-current-time">
            {{ formatTime(clampedTimelineSeconds) }}
          </span>
          <span>
            {{ t("jobCompare.timeline") }}
          </span>
        </div>

        <Slider
          class="mt-2"
          :min="0"
          :max="maxCompareSeconds"
          :step="0.1"
          :model-value="[clampedTimelineSeconds]"
          data-testid="job-compare-timeline"
          @update:model-value="setTimeline"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
