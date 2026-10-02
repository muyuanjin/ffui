<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Music, ExternalLink, Copy } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { buildPreviewUrl, hasTauri, loadPreviewDataUrl, prepareNativeMediaPreview } from "@/lib/backend";

const props = defineProps<{
  kind: "audio" | "image";
  nativeUrl: string;
  sourcePath: string;
}>();
const emit = defineEmits<{ openInSystemPlayer: []; copyPath: [] }>();
const { t } = useI18n();
const audioElement = ref<HTMLAudioElement | null>(null);
const stopPlayback = () => {
  if (audioElement.value && !audioElement.value.paused) audioElement.value.pause();
};
const activeUrl = ref(props.nativeUrl);
const preparing = ref(false);
const converted = ref(false);
const convertedPath = ref("");
const error = ref<{ key: string; diagnostic?: string } | null>(null);
const errorText = computed(() =>
  error.value ? `${t(error.value.key)}${error.value.diagnostic ? `: ${error.value.diagnostic}` : ""}` : "",
);
let requestIdentity = 0;
let dataUrlAttempted = false;

watch(
  () => [props.nativeUrl, props.sourcePath, props.kind],
  () => {
    stopPlayback();
    requestIdentity += 1;
    activeUrl.value = props.nativeUrl;
    preparing.value = false;
    converted.value = false;
    convertedPath.value = "";
    error.value = null;
    dataUrlAttempted = false;
  },
);
onBeforeUnmount(() => {
  stopPlayback();
  requestIdentity += 1;
});

const handleNativeError = async (event: Event) => {
  const target = event.target as HTMLElement | null;
  if (target?.getAttribute("src") !== activeUrl.value || preparing.value || error.value) return;
  const identity = requestIdentity;
  if (!hasTauri() || converted.value) {
    error.value = { key: props.kind === "audio" ? "previewFallback.audioFailed" : "previewFallback.imageFailed" };
    return;
  }
  preparing.value = true;
  let path: string;
  try {
    path = await prepareNativeMediaPreview(props.sourcePath, props.kind);
  } catch (failure) {
    if (identity !== requestIdentity) return;
    error.value = { key: "previewFallback.conversionFailed", diagnostic: String(failure) };
    return;
  } finally {
    if (identity === requestIdentity) preparing.value = false;
  }
  if (identity !== requestIdentity) return;
  convertedPath.value = path;
  activeUrl.value = buildPreviewUrl(path) ?? "";
  converted.value = true;
};

const handleImageError = async (event: Event) => {
  if (props.kind !== "image") return;
  if (converted.value && !dataUrlAttempted && !preparing.value && !error.value && hasTauri()) {
    const target = event.target as HTMLElement | null;
    if (target?.getAttribute("src") !== activeUrl.value) return;
    dataUrlAttempted = true;
    const identity = requestIdentity;
    preparing.value = true;
    let url: string;
    try {
      url = await loadPreviewDataUrl(convertedPath.value);
    } catch (failure) {
      if (identity === requestIdentity)
        error.value = { key: "previewFallback.imageFailed", diagnostic: String(failure) };
      return;
    } finally {
      if (identity === requestIdentity) preparing.value = false;
    }
    if (identity === requestIdentity) activeUrl.value = url;
    return;
  }
  await handleNativeError(event);
};
</script>

<template>
  <div class="w-full h-full flex flex-col items-center justify-center gap-4 p-3" data-testid="native-media-preview">
    <template v-if="!preparing && !error">
      <template v-if="kind === 'audio'">
        <Music class="size-16 text-muted-foreground" aria-hidden="true" />
        <audio
          ref="audioElement"
          :key="activeUrl"
          :src="activeUrl"
          controls
          autoplay
          class="w-full max-w-xl"
          data-testid="task-detail-expanded-audio"
          @error="handleNativeError"
        />
      </template>
      <img
        v-else
        :key="activeUrl"
        :src="activeUrl"
        alt=""
        class="w-full h-full object-contain min-h-0"
        data-testid="task-detail-expanded-image"
        @error="handleImageError"
      />
      <p v-if="converted" class="text-xs text-muted-foreground" data-testid="media-preview-compatible">
        {{ t("previewFallback.compatibleCopy") }}
      </p>
    </template>
    <p v-if="preparing" role="status" class="text-sm text-muted-foreground" data-testid="media-preview-preparing">
      {{ t("previewFallback.preparing") }}
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-xs text-destructive whitespace-pre-wrap break-words"
      data-testid="media-preview-error"
    >
      {{ errorText }}
    </p>
    <div v-if="error" class="flex flex-wrap gap-2">
      <Button size="sm" @click="emit('openInSystemPlayer')"
        ><ExternalLink />{{ t("previewFallback.openInSystemPlayer") }}</Button
      >
      <Button variant="outline" size="sm" @click="emit('copyPath')"><Copy />{{ t("jobDetail.copyPath") }}</Button>
    </div>
  </div>
</template>
