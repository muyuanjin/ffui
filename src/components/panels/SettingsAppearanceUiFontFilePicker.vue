<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import type { AppSettings } from "@/types";
import { hasTauri, importUiFontFile } from "@/lib/backend";
import { applyDownloadedUiFont } from "@/lib/uiFonts";

const props = defineProps<{
  appSettings: AppSettings;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const uiFontFileBusy = ref(false);
const uiFontFileError = ref<string | null>(null);

const getFontFileBasename = (p?: string | null) => {
  const value = (p ?? "").trim();
  if (!value) return "";
  const parts = value.split(/[/\\]/g);
  return parts[parts.length - 1] ?? value;
};

const chooseUiFontFile = async () => {
  if (!hasTauri()) return;
  uiFontFileError.value = null;
  uiFontFileBusy.value = true;
  try {
    const selection = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Font", extensions: ["ttf", "otf"] }],
    });
    const path = typeof selection === "string" ? selection : "";
    if (!path) return;
    const sourceName = getFontFileBasename(path) || undefined;
    const imported = await importUiFontFile(path);
    await applyDownloadedUiFont(imported);
    emit("update:appSettings", {
      ...props.appSettings,
      uiFontFamily: "system",
      uiFontName: imported.familyName,
      uiFontDownloadId: undefined,
      uiFontFilePath: imported.path,
      uiFontFileSourceName: sourceName,
    });
  } catch (error) {
    uiFontFileError.value = String((error as any)?.message ?? error);
  } finally {
    uiFontFileBusy.value = false;
  }
};

const clearUiFontFile = () => {
  emit("update:appSettings", {
    ...props.appSettings,
    uiFontDownloadId: undefined,
    uiFontFilePath: undefined,
    uiFontFileSourceName: undefined,
    uiFontName: undefined,
    uiFontFamily: "system",
  });
};
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-medium text-foreground">
        {{ t("app.settings.uiFontFileLabel") }}
      </p>
      <div class="flex items-center gap-1">
        <Button
          v-if="hasTauri()"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px]"
          :disabled="uiFontFileBusy"
          @click="chooseUiFontFile"
        >
          {{ uiFontFileBusy ? t("app.settings.loadingFonts") : t("app.settings.chooseFontFile") }}
        </Button>
        <Button
          v-if="hasTauri() && props.appSettings.uiFontFilePath"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px]"
          :disabled="uiFontFileBusy"
          @click="clearUiFontFile"
        >
          {{ t("app.settings.clearFontFile") }}
        </Button>
      </div>
    </div>
    <p class="text-[10px] text-muted-foreground leading-snug">
      <span v-if="props.appSettings.uiFontFilePath">
        {{ t("app.settings.currentFontFileLabel") }}
        <span class="font-mono text-foreground">{{
          getFontFileBasename(props.appSettings.uiFontFileSourceName || props.appSettings.uiFontFilePath)
        }}</span>
      </span>
      <span v-else>
        {{ t("app.settings.noFontFileSelected") }}
      </span>
    </p>
    <p v-if="uiFontFileError" class="text-[9px] text-red-500 leading-snug">
      {{ uiFontFileError }}
    </p>
    <p class="text-[9px] text-muted-foreground leading-snug">
      {{ t("app.settings.uiFontFileHelp") }}
    </p>
  </div>
</template>
