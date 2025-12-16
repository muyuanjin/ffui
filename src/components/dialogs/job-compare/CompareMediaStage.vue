<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { useI18n } from "vue-i18n";
import CompareWipeLayers from "./CompareWipeLayers.vue";
import type { CompareMode } from "./CompareViewport.vue";

const props = defineProps<{
  mode: CompareMode;
  usingFrameCompare: boolean;
  inputVideoUrl: string | null;
  outputVideoUrl: string | null;
  inputFrameUrl: string | null;
  inputFrameLoading: boolean;
  inputFrameError: string | null;
  inputFrameQuality?: "low" | "high" | null;
  outputFrameUrl: string | null;
  outputFrameLoading: boolean;
  outputFrameError: string | null;
  outputFrameQuality?: "low" | "high" | null;
  transformStyle: CSSProperties;
  wipePercent: number;
  blinkShowInput: boolean;
}>();

const emit = defineEmits<{
  frameImgError: [side: "input" | "output"];
  nativeError: [];
  "update:wipePercent": [value: number];
}>();

const { t } = useI18n();

const inputFrameStyle = computed(() => {
  if (props.inputFrameQuality !== "low") return undefined;
  return { filter: "blur(1.3px)" } as const;
});

const outputFrameStyle = computed(() => {
  if (props.outputFrameQuality !== "low") return undefined;
  return { filter: "blur(1.3px)" } as const;
});

const handleVideoError = () => {
  emit("nativeError");
};

const handleVideoLoadedMetadata = (event: Event) => {
  const el = event.target as HTMLVideoElement | null;
  if (!el) return;
  if (!el.videoWidth || !el.videoHeight) {
    handleVideoError();
  }
};
</script>

<template>
  <template v-if="!usingFrameCompare && inputVideoUrl && outputVideoUrl">
    <div class="absolute inset-0 flex items-stretch">
      <template v-if="mode === 'side-by-side'">
        <div class="flex-1 relative overflow-hidden">
          <div class="absolute inset-0" :style="transformStyle" data-testid="job-compare-transform-input">
            <video
              :src="inputVideoUrl"
              data-compare-side="input"
              class="w-full h-full object-contain select-none pointer-events-none"
              muted
              playsinline
              draggable="false"
              @dragstart.prevent
              @loadedmetadata="handleVideoLoadedMetadata"
              @error="handleVideoError"
            />
          </div>
        </div>
        <div class="flex-1 relative overflow-hidden">
          <div class="absolute inset-0" :style="transformStyle" data-testid="job-compare-transform-output">
            <video
              :src="outputVideoUrl"
              data-compare-side="output"
              class="w-full h-full object-contain select-none pointer-events-none"
              muted
              playsinline
              draggable="false"
              @dragstart.prevent
              @loadedmetadata="handleVideoLoadedMetadata"
              @error="handleVideoError"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="absolute inset-0 overflow-hidden">
          <CompareWipeLayers
            v-if="mode === 'wipe'"
            :model-value="wipePercent"
            :transform-style="transformStyle"
            @update:model-value="(v) => emit('update:wipePercent', v)"
          >
            <template #input>
              <video
                :src="inputVideoUrl"
                data-compare-side="input"
                class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                muted
                playsinline
                draggable="false"
                @dragstart.prevent
                @loadedmetadata="handleVideoLoadedMetadata"
                @error="handleVideoError"
              />
            </template>
            <template #output>
              <video
                :src="outputVideoUrl"
                data-compare-side="output"
                class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                muted
                playsinline
                draggable="false"
                @dragstart.prevent
                @loadedmetadata="handleVideoLoadedMetadata"
                @error="handleVideoError"
              />
            </template>
          </CompareWipeLayers>

          <div v-else class="absolute inset-0" :style="transformStyle" data-testid="job-compare-transform-overlay">
            <video
              :src="inputVideoUrl"
              data-compare-side="input"
              class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              muted
              playsinline
              draggable="false"
              @dragstart.prevent
              v-show="blinkShowInput"
              @loadedmetadata="handleVideoLoadedMetadata"
              @error="handleVideoError"
            />
            <video
              :src="outputVideoUrl"
              data-compare-side="output"
              class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              muted
              playsinline
              draggable="false"
              @dragstart.prevent
              v-show="!blinkShowInput"
              @loadedmetadata="handleVideoLoadedMetadata"
              @error="handleVideoError"
            />
          </div>
        </div>
      </template>
    </div>
  </template>

  <template v-else>
    <div class="absolute inset-0 flex items-stretch">
      <template v-if="mode === 'side-by-side'">
        <div class="flex-1 relative overflow-hidden">
          <div class="absolute inset-0" :style="transformStyle" data-testid="job-compare-transform-input">
            <img
              v-if="inputFrameUrl"
              :src="inputFrameUrl"
              class="w-full h-full object-contain select-none pointer-events-none"
              :style="inputFrameStyle"
              draggable="false"
              @dragstart.prevent
              alt=""
              @error="emit('frameImgError', 'input')"
            />
          </div>
          <div
            v-if="inputFrameLoading && !inputFrameUrl"
            class="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground"
          >
            {{ t("jobCompare.loadingFrame") }}
          </div>
          <div
            v-if="inputFrameError"
            class="absolute inset-0 flex items-center justify-center text-[11px] text-destructive bg-destructive/10"
          >
            {{ inputFrameError }}
          </div>
        </div>

        <div class="flex-1 relative overflow-hidden">
          <div class="absolute inset-0" :style="transformStyle" data-testid="job-compare-transform-output">
            <img
              v-if="outputFrameUrl"
              :src="outputFrameUrl"
              class="w-full h-full object-contain select-none pointer-events-none"
              :style="outputFrameStyle"
              draggable="false"
              @dragstart.prevent
              alt=""
              @error="emit('frameImgError', 'output')"
            />
          </div>
          <div
            v-if="outputFrameLoading && !outputFrameUrl"
            class="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground"
          >
            {{ t("jobCompare.loadingFrame") }}
          </div>
          <div
            v-if="outputFrameError"
            class="absolute inset-0 flex items-center justify-center text-[11px] text-destructive bg-destructive/10"
          >
            {{ outputFrameError }}
          </div>
        </div>
      </template>

      <template v-else>
        <div class="absolute inset-0 overflow-hidden">
          <CompareWipeLayers
            v-if="mode === 'wipe'"
            :model-value="wipePercent"
            :transform-style="transformStyle"
            @update:model-value="(v) => emit('update:wipePercent', v)"
          >
            <template #input>
              <img
                v-if="inputFrameUrl"
                :src="inputFrameUrl"
                class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                :style="inputFrameStyle"
                draggable="false"
                @dragstart.prevent
                alt=""
                @error="emit('frameImgError', 'input')"
              />
            </template>
            <template #output>
              <img
                v-if="outputFrameUrl"
                :src="outputFrameUrl"
                class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
                :style="outputFrameStyle"
                draggable="false"
                @dragstart.prevent
                alt=""
                @error="emit('frameImgError', 'output')"
              />
            </template>
          </CompareWipeLayers>

          <div v-else class="absolute inset-0" :style="transformStyle" data-testid="job-compare-transform-overlay">
            <img
              v-if="inputFrameUrl"
              :src="inputFrameUrl"
              class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              v-show="blinkShowInput"
              :style="inputFrameStyle"
              draggable="false"
              @dragstart.prevent
              alt=""
              @error="emit('frameImgError', 'input')"
            />
            <img
              v-if="outputFrameUrl"
              :src="outputFrameUrl"
              class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
              v-show="!blinkShowInput"
              :style="outputFrameStyle"
              draggable="false"
              @dragstart.prevent
              alt=""
              @error="emit('frameImgError', 'output')"
            />
          </div>
        </div>
      </template>
    </div>
  </template>
</template>
