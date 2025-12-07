<script setup lang="ts">
import { ref, toRef, watch } from "vue";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";

const props = defineProps<{
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

const open = toRef(props, "open");
const job = toRef(props, "job");
const previewUrl = toRef(props, "previewUrl");
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

// 控制视频标签的 controls 何时显示：刚打开预览时完全隐藏，直到用户在视频区域内产生交互，
// 避免一开始出现黑色 loading 圆圈或控制条闪现。
const showVideoControls = ref(false);

// 当对话框关闭、预览 URL 变化或切换为图片时，重置控制条可见状态。
watch(
  [open, previewUrl, isImage],
  ([openVal, previewUrlVal, isImageVal]) => {
    if (!openVal || !previewUrlVal || isImageVal) {
      showVideoControls.value = false;
      return;
    }
  },
  { immediate: true },
);

// 用户在视频区域产生交互（鼠标移动/触摸）时再启用 controls，
// 此时浏览器会按照“自动隐藏”的原生策略显示/隐藏控制条。
const handleVideoInteraction = () => {
  if (!showVideoControls.value) {
    showVideoControls.value = true;
  }
};

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
      <div
        class="mt-2 relative w-full max-h-[70vh] rounded-md bg-black flex items-center justify-center overflow-hidden"
        @mousemove="handleVideoInteraction"
        @touchstart="handleVideoInteraction"
      >
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
            :controls="showVideoControls"
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
