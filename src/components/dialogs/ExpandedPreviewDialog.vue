<script setup lang="ts">
import { computed, toRef, watch } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import FallbackMediaPreview from "@/components/media/FallbackMediaPreview.vue";
import { cleanupFallbackPreviewFramesAsync, hasTauri } from "@/lib/backend";

const props = defineProps<{
  /** Whether dialog is open */
  open: boolean;
  /** The job to preview */
  job: TranscodeJob | null;
  /** Preview URL (may be different from job.previewPath for Tauri file:// URLs) */
  previewUrl: string | null;
  /** Underlying raw filesystem path currently being previewed (used for FFmpeg fallback) */
  previewPath: string | null;
  /** Whether the preview is an image */
  isImage: boolean;
  /** Error message to display */
  error: string | null;
}>();

const open = toRef(props, "open");
const job = toRef(props, "job");
const previewUrl = toRef(props, "previewUrl");
const previewPath = toRef(props, "previewPath");
const isImage = toRef(props, "isImage");
const error = toRef(props, "error");

const emit = defineEmits<{
  "update:open": [value: boolean];
  videoError: [];
  imageError: [];
  openInSystemPlayer: [];
  copyPath: [];
}>();

const { t } = useI18n();

const videoSourcePath = computed(() => {
  return (
    previewPath.value ||
    props.job?.outputPath ||
    props.job?.inputPath ||
    null
  );
});

const forceFallback = computed(() => !isImage.value && !!error.value);

watch(
  () => props.open,
  (open, prev) => {
    if (prev && !open && hasTauri()) {
      void cleanupFallbackPreviewFramesAsync();
    }
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle class="text-base">
          {{ job?.filename || t("jobDetail.preview") }}
        </DialogTitle>
        <DialogDescription class="text-[11px] text-muted-foreground">
          {{ t("jobDetail.previewDescription") }}
        </DialogDescription>
      </DialogHeader>
      <div
        class="mt-2 relative w-full max-h-[70vh] rounded-md bg-black flex items-center justify-center overflow-hidden"
      >
        <template v-if="previewUrl">
          <img
            v-if="isImage"
            :src="previewUrl"
            alt=""
            class="w-full h-full object-contain"
            @error="emit('imageError')"
          />
          <FallbackMediaPreview
            v-else
            :native-url="previewUrl"
            :source-path="videoSourcePath"
            :duration-seconds="job?.mediaInfo?.durationSeconds ?? null"
            :autoplay="true"
            :lazy-controls="true"
            :auto-fallback-on-native-error="false"
            :force-fallback="forceFallback"
            :error-text="error"
            :show-copy-path-action="true"
            video-test-id="task-detail-expanded-video"
            @native-error="emit('videoError')"
            @open-in-system-player="emit('openInSystemPlayer')"
            @copy-path="emit('copyPath')"
          />
        </template>
        <p
          v-else
          data-testid="task-detail-expanded-fallback"
          class="text-[11px] text-muted-foreground"
        >
          {{ t("jobDetail.noPreview") }}
        </p>
      </div>
      <div v-if="error && isImage" class="mt-2 text-[11px] text-destructive">
        <p>{{ error }}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <Button size="xs" class="h-6 px-2 text-[10px]" @click="emit('openInSystemPlayer')">
            {{ t("jobDetail.openInSystemPlayer") }}
          </Button>
          <Button variant="outline" size="xs" class="h-6 px-2 text-[10px]" @click="emit('copyPath')">
            {{ t("jobDetail.copyPath") }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
