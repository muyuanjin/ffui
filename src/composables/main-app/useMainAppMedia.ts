import { ref, type Ref } from "vue";
import type { ParsedMediaAnalysis } from "@/lib/mediaInfo";
import { parseFfprobeJsonAsyncLite } from "@/lib/asyncJson";
import { EXTENSIONS } from "@/constants";
import { mediaKindForPath, type MediaKind } from "@/lib/mediaKind";
import { buildPreviewUrl, hasTauri, inspectMedia } from "@/lib/backend";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { MainAppTab } from "./useMainAppShell";

export interface UseMainAppMediaOptions {
  t: (key: string) => string;
  activeTab: Ref<MainAppTab>;
}

export interface UseMainAppMediaReturn {
  inspectedMediaPath: Ref<string | null>;
  inspectedPreviewUrl: Ref<string | null>;
  inspectedIsImage: Ref<boolean>;
  inspectedMediaKind: Ref<MediaKind>;
  inspectedRawJson: Ref<string | null>;
  inspectedAnalysis: Ref<ParsedMediaAnalysis | null>;
  isInspectingMedia: Ref<boolean>;
  mediaInspectError: Ref<string | null>;
  clearInspectedMedia: () => void;
  inspectMediaForPath: (path: string) => Promise<void>;
  openMediaFileDialog: () => Promise<void>;
}

/**
 * Media inspector state and helpers for the Media tab.
 */
export function useMainAppMedia(options: UseMainAppMediaOptions): UseMainAppMediaReturn {
  const { t, activeTab } = options;

  const inspectedMediaPath = ref<string | null>(null);
  const inspectedPreviewUrl = ref<string | null>(null);
  const inspectedIsImage = ref(false);
  const inspectedMediaKind = ref<MediaKind>("video");
  const inspectedRawJson = ref<string | null>(null);
  const inspectedAnalysis = ref<ParsedMediaAnalysis | null>(null);
  const isInspectingMedia = ref(false);
  const mediaInspectError = ref<string | null>(null);

  const clearInspectedMedia = () => {
    inspectedMediaPath.value = null;
    inspectedPreviewUrl.value = null;
    inspectedIsImage.value = false;
    inspectedMediaKind.value = "video";
    inspectedRawJson.value = null;
    inspectedAnalysis.value = null;
    mediaInspectError.value = null;
  };

  const inspectMediaForPath = async (path: string) => {
    clearInspectedMedia();
    inspectedMediaPath.value = path;
    mediaInspectError.value = null;
    isInspectingMedia.value = true;

    try {
      const json = await inspectMedia(path);
      inspectedRawJson.value = json;
      inspectedAnalysis.value = await parseFfprobeJsonAsyncLite(json);

      const kind = mediaKindForPath(path);
      inspectedMediaKind.value = kind;
      inspectedIsImage.value = kind === "image";

      try {
        const url = buildPreviewUrl(path);
        inspectedPreviewUrl.value = url;
      } catch (e) {
        console.error("Failed to build preview URL for inspected media:", e);
        inspectedPreviewUrl.value = null;
      }
    } catch (e) {
      console.error("Failed to inspect media:", e);
      mediaInspectError.value = t("media.inspectError") as string;
    } finally {
      isInspectingMedia.value = false;
    }
  };

  const openMediaFileDialog = async () => {
    if (!hasTauri()) return;
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Media",
            extensions: [
              ...EXTENSIONS.videos.map((ext) => ext.replace(/^\./, "")),
              ...EXTENSIONS.images.map((ext) => ext.replace(/^\./, "")),
              ...EXTENSIONS.audios.map((ext) => ext.replace(/^\./, "")),
            ],
          },
        ],
      });

      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path === "string" && path) {
        await inspectMediaForPath(path);
        activeTab.value = "media";
      }
    } catch (e) {
      console.error("Failed to open media file dialog:", e);
    }
  };

  return {
    inspectedMediaPath,
    inspectedPreviewUrl,
    inspectedIsImage,
    inspectedMediaKind,
    inspectedRawJson,
    inspectedAnalysis,
    isInspectingMedia,
    mediaInspectError,
    clearInspectedMedia,
    inspectMediaForPath,
    openMediaFileDialog,
  };
}

export default useMainAppMedia;
