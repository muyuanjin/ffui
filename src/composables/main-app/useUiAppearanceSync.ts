import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings } from "@/types";
import { applyUiAppearanceToDocument } from "@/lib/uiAppearance";
import { applyDownloadedUiFont, applyUiFontFilePath, startOpenSourceFontDownload } from "@/lib/uiFonts";
import { cancelOpenSourceFontDownload, hasTauri, type UiFontDownloadSnapshot } from "@/lib/backend";

export function useUiAppearanceSync(appSettings: Ref<AppSettings | null>) {
  watch(
    () => appSettings.value,
    (value) => {
      applyUiAppearanceToDocument({
        uiScalePercent: value?.uiScalePercent,
        uiFontSizePercent: value?.uiFontSizePercent,
        uiFontFamily: value?.uiFontFamily,
        uiFontName: value?.uiFontName,
      });
    },
    { immediate: true },
  );

  let requestId = 0;
  let currentSessionId = 0;
  let currentFontId: string | null = null;
  let unlistenFontDownload: null | (() => void) = null;

  onMounted(async () => {
    if (!hasTauri()) return;
    unlistenFontDownload = await listen<UiFontDownloadSnapshot>(
      "ui_font_download",
      async (event) => {
        const payload = event.payload;
        const desired = currentFontId;
        if (!desired || payload.fontId !== desired) return;
        if (currentSessionId && payload.sessionId !== currentSessionId) return;
        if (payload.status !== "ready" || !payload.path) return;
        await applyDownloadedUiFont({
          id: payload.fontId,
          familyName: payload.familyName,
          path: payload.path,
          format: payload.format,
        });
      },
    );
  });

  onUnmounted(() => {
    unlistenFontDownload?.();
    unlistenFontDownload = null;
  });

  watch(
    () => appSettings.value?.uiFontDownloadId ?? null,
    async (fontId) => {
      if (!fontId) {
        if (currentFontId) {
          try {
            await cancelOpenSourceFontDownload?.(currentFontId);
          } catch {
            // Best-effort.
          }
        }
        currentSessionId = 0;
        currentFontId = null;
        return;
      }
      const current = ++requestId;
      try {
        if (currentFontId && currentFontId !== fontId) {
          // Avoid background downloads for fonts the user no longer wants.
          await cancelOpenSourceFontDownload?.(currentFontId);
        }

        currentFontId = fontId;
        const snapshot = await startOpenSourceFontDownload(fontId);
        currentSessionId = snapshot?.sessionId ?? 0;
      } catch (error) {
        if (current !== requestId) return;
        console.error("Failed to ensure open-source UI font", error);
      }
    },
    { immediate: true },
  );

  watch(
    () => ({
      path: appSettings.value?.uiFontFilePath ?? null,
      familyName: appSettings.value?.uiFontName ?? null,
    }),
    async ({ path, familyName }) => {
      if (!path) return;
      const resolvedFamily = (familyName ?? "").trim() || "FFUI Imported";
      try {
        await applyUiFontFilePath({
          id: "imported",
          path,
          familyName: resolvedFamily,
        });
      } catch (error) {
        console.error("Failed to apply imported UI font file", error);
      }
    },
    { immediate: true },
  );
}
