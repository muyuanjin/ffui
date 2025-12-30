import { computed, proxyRefs } from "vue";
import { useMediaDomain } from "@/MainApp.setup";

export function useMainMediaTabOrchestrator() {
  const media = useMediaDomain();

  const panelProps = proxyRefs({
    inspecting: computed(() => media.isInspectingMedia.value),
    error: computed(() => media.mediaInspectError.value),
    inspectedPath: computed(() => media.inspectedMediaPath.value),
    previewUrl: computed(() => media.inspectedPreviewUrl.value),
    isImage: computed(() => media.inspectedIsImage.value),
    analysis: computed(() => media.inspectedAnalysis.value),
    rawJson: computed(() => media.inspectedRawJson.value),
  });

  const panelListeners = {
    inspectRequested: media.openMediaFileDialog,
    clear: media.clearInspectedMedia,
  } as const;

  return { panelProps, panelListeners };
}
