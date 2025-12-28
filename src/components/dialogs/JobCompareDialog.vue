<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { JobCompareOutput, JobCompareSources, TranscodeJob } from "@/types";
import { buildPlayableMediaUrl, getJobCompareSources, hasTauri } from "@/lib/backend";
import CompareViewport from "./job-compare/CompareViewport.vue";
import type { CompareMode } from "./job-compare/types";
import { useJobCompareFrames } from "./job-compare/useJobCompareFrames";
import { useJobComparePlaybackSync } from "./job-compare/useJobComparePlaybackSync";
import { useJobCompareOutOfRangeHint } from "./job-compare/useJobCompareOutOfRangeHint";
import { useJobCompareRememberedTimeline } from "./job-compare/useJobCompareRememberedTimeline";
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
const viewportRef = ref<InstanceType<typeof CompareViewport> | null>(null);
const timelineWrapEl = ref<HTMLElement | null>(null);
const jobRef = toRef(props, "job");
const openRef = toRef(props, "open");
const totalDurationSeconds = computed(() => {
  const d = props.job?.mediaInfo?.durationSeconds;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
});
const timelineMaxSeconds = computed(() => {
  const total = totalDurationSeconds.value;
  if (total != null && total > 0) return total;
  const fallback = sources.value?.maxCompareSeconds;
  return typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
});
const maxCompareSeconds = computed(() => {
  const reported = sources.value?.maxCompareSeconds;
  const status = props.job?.status;
  const acceptZero = status === "processing" || status === "paused";
  const maxFromSources =
    typeof reported === "number" && Number.isFinite(reported) && (acceptZero ? reported >= 0 : reported > 0)
      ? reported
      : null;
  const total = totalDurationSeconds.value;
  if (maxFromSources != null && total != null) return Math.min(maxFromSources, total);
  if (maxFromSources != null) return maxFromSources;
  return total ?? 0;
});
const compareIncomplete = computed(() => {
  const total = timelineMaxSeconds.value;
  const max = maxCompareSeconds.value;
  if (!Number.isFinite(total) || total <= 0) return false;
  if (!Number.isFinite(max) || max < 0) return false;
  return max < total - 0.001;
});
const compareLimitPercent = computed(() => {
  if (!compareIncomplete.value) return 100;
  const total = timelineMaxSeconds.value;
  const max = maxCompareSeconds.value;
  if (!Number.isFinite(total) || total <= 0) return 100;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (max / total) * 100));
});

// Seeking to the exact end can trigger 416 / decoder edge cases in some webviews.
// Keep a tiny buffer so all seeks stay strictly within the playable range.
const maxSeekSeconds = computed(() => {
  const max = maxCompareSeconds.value;
  if (!Number.isFinite(max) || max <= 0) return max;
  const epsilon = 0.001;
  return max > epsilon ? max - epsilon : 0;
});
const clampedTimelineSeconds = computed(() => {
  const raw = timeline.value[0] ?? 0;
  const max = maxSeekSeconds.value;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return raw;
  return Math.min(raw, max);
});
watch(
  () => maxCompareSeconds.value,
  (max) => {
    if (!Number.isFinite(max) || max <= 0) return;
    const seekMax = maxSeekSeconds.value;
    if ((timeline.value[0] ?? 0) > seekMax) {
      timeline.value = [seekMax];
    }
  },
);
const compareLabel = computed(() => {
  const max = maxCompareSeconds.value;
  const total = totalDurationSeconds.value;
  if (!Number.isFinite(max) || max < 0) return null;
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
  requestHighFramesNow,
  handleFrameImgError,
} = frames;
const getViewportEl = () => viewportRef.value?.getContainerEl?.() ?? null;
const getSideVideos = (side: "input" | "output") => {
  const el = getViewportEl();
  if (!el) return [] as HTMLVideoElement[];
  return Array.from(el.querySelectorAll(`video[data-compare-side="${side}"]`)) as HTMLVideoElement[];
};
const getMasterVideo = () => getSideVideos("input")[0] ?? null;
const playback = useJobComparePlaybackSync({
  isPlaying,
  maxCompareSeconds: maxSeekSeconds,
  timeline,
  getSideVideos,
  getMasterVideo,
});
const { stopPlayback, scheduleSeekVideos, seekVideos, clearPendingSeek, cleanup: cleanupPlayback } = playback;
const togglePlay = async () => {
  if (usingFrameCompare.value) return;
  await playback.togglePlay(clampedTimelineSeconds.value);
};

const handleResetZoom = () => {
  viewportRef.value?.resetZoom?.();
};

const { outOfRangeHintVisible, allowTimelineSecondsOrHint, handleTimelinePointerDownCapture } =
  useJobCompareOutOfRangeHint({
    compareIncomplete,
    timelineWrapEl,
    timelineMaxSeconds,
    maxCompareSeconds,
  });

const setTimeline = (value: number[] | undefined) => {
  const raw = value?.length ? value[0] : 0;
  const safe = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  if (!allowTimelineSecondsOrHint(safe)) return;
  timeline.value = [safe];
  if (usingFrameCompare.value) return;
  if (!isPlaying.value) return;

  const current = timeline.value[0] ?? 0;
  const max = maxSeekSeconds.value;
  const clamped =
    !Number.isFinite(current) || current < 0 ? 0 : Number.isFinite(max) && max > 0 ? Math.min(current, max) : current;
  clearPendingSeek();
  seekVideos(clamped);
};

const { rememberTimelineForActiveInput, restoreTimelineForActiveInput } = useJobCompareRememberedTimeline({
  inputPath,
  job: jobRef,
  timeline,
  clampedTimelineSeconds,
});

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
  stopPlayback();
  resetFrames();
  clearFrameTimers();

  try {
    const result = await getJobCompareSources(job.id);
    sources.value = result;
    if (!result) {
      sourcesError.value = t("jobCompare.unavailable") as string;
      timeline.value = [0];
      return;
    }

    // Restore timeline only when the input path matches a previous compare session.
    restoreTimelineForActiveInput();

    // The seek watcher may run before videos are actually in the DOM. Schedule a
    // second seek after the viewport renders so both sides start on the same frame.
    if (!usingFrameCompare.value) {
      // Let Vue render the <video> elements, then run a seek pass that retries
      // until metadata is available on both sides.
      void Promise.resolve().then(() => {
        window.setTimeout(() => {
          if (!props.open) return;
          if (usingFrameCompare.value) return;
          if (isPlaying.value) return;
          scheduleSeekVideos(clampedTimelineSeconds.value);
        }, 0);
      });
    }
  } catch (error) {
    sourcesError.value = (error as Error)?.message ?? String(error);
  } finally {
    loadingSources.value = false;
  }
};

watch(
  () => [props.open, props.job?.id] as const,
  ([open, jobId], oldValue) => {
    const [prevOpen, prevJobId] = oldValue ?? [false, undefined];
    // Persist the current position for the previous job before switching.
    if (prevOpen && open && prevJobId && prevJobId !== jobId) {
      rememberTimelineForActiveInput();
    }
    void fetchSources();
  },
  { immediate: true },
);

watch(
  () => props.open,
  (open, prev) => {
    if (!prev && open) {
      // Open: restore (if input matches) so multi-output experiments stay aligned.
      restoreTimelineForActiveInput();
    }
    if (prev && !open) {
      rememberTimelineForActiveInput();
      stopPlayback();
      clearPendingSeek();
      clearFrameTimers();
    }
  },
);

watch(
  () => [usingFrameCompare.value, clampedTimelineSeconds.value] as const,
  ([frameMode, seconds]) => {
    if (frameMode) return;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    // Avoid re-seeking the master while playing; the playback sync loop is the source of truth.
    if (isPlaying.value) return;
    scheduleSeekVideos(seconds);
  },
);

watch(
  () => [props.open, playbackEligible.value, usingFrameCompare.value] as const,
  ([open, eligible, frameMode]) => {
    if (!open) return;
    if (frameMode) return;
    if (!eligible) return;
    if (isPlaying.value) return;
    window.setTimeout(() => scheduleSeekVideos(clampedTimelineSeconds.value), 0);
  },
);

const handleNativeError = () => {
  forceFrameCompare.value = true;
  stopPlayback();
  clearPendingSeek();
};

onBeforeUnmount(() => {
  cleanupPlayback();
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
  <Dialog :open="open" :modal="false" @update:open="emit('update:open', $event)">
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
        <div class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span data-testid="job-compare-current-time">
            {{ formatTime(clampedTimelineSeconds) }}
          </span>
          <span class="truncate">
            {{ t("jobCompare.timeline") }}
          </span>
          <span
            v-if="compareLabel"
            class="shrink-0"
            data-testid="job-compare-max-label"
            :title="String(t('jobCompare.maxLabelHint'))"
          >
            {{ compareLabel }}
          </span>
        </div>

        <div
          ref="timelineWrapEl"
          class="relative mt-2"
          data-testid="job-compare-timeline-wrap"
          @pointerdown.capture="handleTimelinePointerDownCapture"
        >
          <Slider
            :min="0"
            :max="timelineMaxSeconds"
            :step="0.1"
            :model-value="[clampedTimelineSeconds]"
            data-testid="job-compare-timeline"
            @update:model-value="setTimeline"
            @valueCommit="() => requestHighFramesNow()"
          />
          <div
            v-if="compareIncomplete"
            class="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2"
            aria-hidden="true"
          >
            <div
              class="absolute inset-y-0 bg-muted/60 rounded-r-full border-l border-white/10"
              :style="{ left: `${compareLimitPercent}%`, right: '0' }"
            />
          </div>
        </div>

        <div
          v-if="compareIncomplete"
          class="mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-500"
          data-testid="job-compare-partial-warning"
        >
          {{
            t("jobCompare.partialWarning", {
              max: formatTime(maxCompareSeconds),
              total: formatTime(timelineMaxSeconds),
            })
          }}
        </div>

        <div
          v-if="outOfRangeHintVisible"
          class="mt-1 text-[11px] text-yellow-500"
          data-testid="job-compare-out-of-range-hint"
        >
          {{ t("jobCompare.outOfRangeHint") }}
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
