<script setup lang="ts">
import type { UseMainAppMediaReturn } from "@/composables/main-app/useMainAppMedia";
import { MediaPanel } from "@/components/main/lazyTabs";

const props = defineProps<{
  media: UseMainAppMediaReturn;
}>();

const media = props.media;
</script>

<template>
  <MediaPanel
    :inspecting="media.isInspectingMedia.value"
    :error="media.mediaInspectError.value"
    :inspected-path="media.inspectedMediaPath.value"
    :preview-url="media.inspectedPreviewUrl.value"
    :is-image="media.inspectedIsImage.value"
    :analysis="media.inspectedAnalysis.value"
    :raw-json="media.inspectedRawJson.value"
    @inspect-requested="media.openMediaFileDialog"
    @clear="media.clearInspectedMedia"
  />
</template>
