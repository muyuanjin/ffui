<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";

defineProps<{
  /** Whether dialog is open */
  open: boolean;
  /** The job to preview */
  job: TranscodeJob | null;
  /** Preview URL (may be different from job.previewPath for Tauri file:// URLs) */
  previewUrl: string | null;
  /** Whether the preview is an image */
  isImage: boolean;
  /** Error message to display */
  error: string | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  videoError: [];
  imageError: [];
  openInSystemPlayer: [];
  copyPath: [];
}>();

const { t } = useI18n();

const handleVideoLoadedMetadata = (event: Event) => {
  const el = event.target as HTMLVideoElement | null;
  if (!el) return;

  // 如果浏览器只能解码音频而无法解码视频流，videoWidth/videoHeight 往往保持为 0。
  // 这种情况下我们主动视为“预览失败”，停止播放并提示用户使用系统播放器。
  if (!el.videoWidth || !el.videoHeight) {
    try {
      el.pause();
      el.removeAttribute("src");
      // 触发一次 load 以重置内部状态，避免继续播放“纯音频”。
      el.load();
    } catch {
      // 在某些测试环境（jsdom/happy-dom）上这些方法可能是 no-op，忽略异常即可。
    }
    emit("videoError");
  }
};
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
      <div class="mt-2 relative w-full max-h-[70vh] rounded-md bg-black flex items-center justify-center overflow-hidden">
        <template v-if="previewUrl">
          <img
            v-if="isImage"
            :src="previewUrl"
            alt=""
            class="w-full h-full object-contain"
            @error="emit('imageError')"
          />
          <video
            v-else
            :src="previewUrl"
            data-testid="task-detail-expanded-video"
            class="w-full h-full object-contain"
            controls
            autoplay
            @loadedmetadata="handleVideoLoadedMetadata"
            @error="emit('videoError')"
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
      <div v-if="error" class="mt-2 text-[11px] text-destructive">
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
