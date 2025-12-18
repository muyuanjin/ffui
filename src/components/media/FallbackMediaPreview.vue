<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Copy, ExternalLink } from "lucide-vue-next";
import {
  buildPreviewUrl,
  extractFallbackPreviewFrame,
  hasTauri,
  loadPreviewDataUrl,
  type FallbackFrameQuality,
} from "@/lib/backend";

const props = withDefaults(
  defineProps<{
    nativeUrl: string | null;
    sourcePath: string | null;
    durationSeconds?: number | null;
    autoplay?: boolean;
    lazyControls?: boolean;
    autoFallbackOnNativeError?: boolean;
    forceFallback?: boolean;
    errorText?: string | null;
    showHint?: boolean;
    showCopyPathAction?: boolean;
    videoTestId?: string;
  }>(),
  {
    autoplay: false,
    lazyControls: false,
    autoFallbackOnNativeError: true,
    forceFallback: false,
    errorText: null,
    showHint: false,
    showCopyPathAction: false,
  },
);

const emit = defineEmits<{
  nativeError: [];
  openInSystemPlayer: [];
  copyPath: [];
}>();

const { t } = useI18n();

const activeVideoUrl = ref<string | null>(props.nativeUrl);

const fallbackMode = ref(false);
const frameError = ref<string | null>(null);

const framePath = ref<string | null>(null);
const frameUrl = ref<string | null>(null);
const frameLoading = ref(false);

const scrubPercent = ref<number[]>([50]);

const showVideoControls = ref(false);
const resetVideoControls = () => {
  showVideoControls.value = false;
};

const hasSourcePath = computed(() => typeof props.sourcePath === "string" && !!props.sourcePath);

const lowTimer = ref<number | null>(null);
const highTimer = ref<number | null>(null);
const requestToken = ref(0);

const clearTimers = () => {
  if (lowTimer.value != null) {
    window.clearTimeout(lowTimer.value);
    lowTimer.value = null;
  }
  if (highTimer.value != null) {
    window.clearTimeout(highTimer.value);
    highTimer.value = null;
  }
};

const enterFallbackMode = () => {
  if (!hasSourcePath.value) return;
  fallbackMode.value = true;
  frameError.value = null;
  void requestFrame("high");
};

watch(
  () => [props.nativeUrl, props.sourcePath] as const,
  ([nativeUrl]) => {
    activeVideoUrl.value = nativeUrl;
    fallbackMode.value = false;
    frameError.value = null;
    framePath.value = null;
    frameUrl.value = null;
    frameLoading.value = false;
    scrubPercent.value = [50];
    clearTimers();
    resetVideoControls();
  },
  { immediate: true },
);

watch(
  () => props.forceFallback,
  (force) => {
    if (force) {
      enterFallbackMode();
    } else {
      fallbackMode.value = false;
    }
  },
  { immediate: true },
);

async function requestFrame(quality: FallbackFrameQuality) {
  if (!hasSourcePath.value || !props.sourcePath) return;
  if (!hasTauri()) return;

  const token = ++requestToken.value;
  frameLoading.value = true;
  frameError.value = null;

  try {
    const path = await extractFallbackPreviewFrame({
      sourcePath: props.sourcePath,
      positionPercent: scrubPercent.value[0] ?? 50,
      durationSeconds: props.durationSeconds ?? null,
      quality,
    });

    if (token !== requestToken.value) return;

    framePath.value = path;
    frameUrl.value = buildPreviewUrl(path);
    frameLoading.value = false;
  } catch (error) {
    if (token !== requestToken.value) return;
    frameLoading.value = false;
    frameError.value = (error as Error)?.message ?? String(error);
  }
}

const handleFrameImgError = async () => {
  const path = framePath.value;
  if (!path) return;
  if (!hasTauri()) return;

  try {
    frameUrl.value = await loadPreviewDataUrl(path);
  } catch (error) {
    frameError.value = (error as Error)?.message ?? String(error);
  }
};

const scheduleLowFrame = () => {
  if (!fallbackMode.value) return;
  if (lowTimer.value != null) window.clearTimeout(lowTimer.value);
  lowTimer.value = window.setTimeout(() => void requestFrame("low"), 120);
};

const commitHighFrame = () => {
  if (!fallbackMode.value) return;
  clearTimers();
  void requestFrame("high");
};

const handleVideoInteraction = () => {
  if (!props.lazyControls) return;
  if (!showVideoControls.value) {
    showVideoControls.value = true;
  }
};

const handleNativeVideoError = () => {
  emit("nativeError");

  if (props.autoFallbackOnNativeError) {
    enterFallbackMode();
  }
};

const handleVideoLoadedMetadata = (event: Event) => {
  const el = event.target as HTMLVideoElement | null;
  if (!el) return;

  if (!el.videoWidth || !el.videoHeight) {
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch {
      // ignore
    }
    handleNativeVideoError();
  }
};

const videoControls = computed(() => {
  if (props.lazyControls) return showVideoControls.value;
  return true;
});

const warningText = computed(() => {
  const explicit = (props.errorText ?? "").trim();
  return explicit || (t("previewFallback.nativePlaybackFailed") as string);
});

onBeforeUnmount(() => {
  clearTimers();
});
</script>

<template>
  <div class="w-full h-full">
    <template v-if="!fallbackMode && activeVideoUrl">
      <video
        :src="activeVideoUrl"
        :data-testid="videoTestId"
        class="w-full h-full object-contain"
        :controls="videoControls"
        :autoplay="autoplay"
        @loadedmetadata="handleVideoLoadedMetadata"
        @error="handleNativeVideoError"
        @mousemove="handleVideoInteraction"
        @touchstart="handleVideoInteraction"
      />
    </template>

    <template v-else>
      <div class="w-full h-full flex flex-col gap-2 p-2 sm:p-3" data-testid="fallback-media-preview">
        <div class="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5">
          <div class="font-medium">
            {{ t("previewFallback.title") }}
          </div>
          <div class="mt-0.5 text-foreground/80">
            {{ warningText }}
          </div>
          <div v-if="props.showHint" class="mt-0.5 text-muted-foreground">
            {{ t("previewFallback.hint") }}
          </div>
        </div>

        <div class="flex-1 min-h-0 rounded-md bg-black flex items-center justify-center overflow-hidden">
          <template v-if="frameUrl">
            <img :src="frameUrl" alt="" class="w-full h-full object-contain" @error="handleFrameImgError" />
          </template>
          <template v-else>
            <div class="text-[11px] text-muted-foreground px-3 py-2 text-center">
              <span v-if="frameLoading">{{ t("previewFallback.loadingFrame") }}</span>
              <span v-else>{{ t("previewFallback.noFrame") }}</span>
            </div>
          </template>
        </div>

        <div class="rounded-md border border-border/40 bg-background/5 backdrop-blur-sm p-2 space-y-2">
          <div class="flex items-center gap-3">
            <Slider
              v-model="scrubPercent"
              class="flex-1"
              :min="0"
              :max="100"
              :step="1"
              @update:modelValue="scheduleLowFrame"
              @valueCommit="commitHighFrame"
            />
            <span class="min-w-[3.25rem] text-right text-xs text-muted-foreground tabular-nums">
              {{ (scrubPercent[0] ?? 0).toFixed(0) }}%
            </span>
          </div>

          <div v-if="frameError" class="text-xs text-destructive whitespace-pre-wrap break-words">
            {{ frameError }}
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <Button size="sm" class="h-7 px-2 text-xs" type="button" @click="emit('openInSystemPlayer')">
              <ExternalLink />
              {{ t("previewFallback.openInSystemPlayer") }}
            </Button>
            <Button
              v-if="showCopyPathAction"
              variant="outline"
              size="sm"
              class="h-7 px-2 text-xs"
              type="button"
              @click="emit('copyPath')"
            >
              <Copy />
              {{ t("jobDetail.copyPath") }}
            </Button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
