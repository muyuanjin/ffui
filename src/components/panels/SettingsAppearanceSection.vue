<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppSettings } from "@/types";
import SettingsOpenSourceFontDownloadStatus from "@/components/panels/SettingsOpenSourceFontDownloadStatus.vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { applyDownloadedUiFont } from "@/lib/uiFonts";
import { getSystemFontSuggestions, resolveSystemFontFamilyName } from "@/lib/systemFontSearch";
import {
  fetchSystemFontFamilies,
  hasTauri,
  importUiFontFile,
  listOpenSourceFonts,
  type OpenSourceFontInfo,
} from "@/lib/backend";
const props = defineProps<{
  appSettings: AppSettings | null;
}>();
const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();
const { t, locale } = useI18n();
const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};
type UiFontMode = "default" | "system" | "openSource" | "file";
const uiFontModeSticky = ref<UiFontMode>("default");
const uiScalePercentModel = computed<string>({
  get() {
    const value = props.appSettings?.uiScalePercent;
    const raw = typeof value === "number" && Number.isFinite(value) ? value : 100;
    const stepped = Math.min(200, Math.max(50, Math.round(raw / 5) * 5));
    return String(stepped);
  },
  set(value) {
    updateSetting("uiScalePercent", Number(value) as AppSettings["uiScalePercent"]);
  },
});
const uiFontSizePxModel = computed<string>({
  get() {
    const value = props.appSettings?.uiFontSizePercent;
    const percent = typeof value === "number" && Number.isFinite(value) ? value : 100;
    const px = Math.round((16 * percent) / 100);
    const nearest = fontSizePxOptions.reduce((best, cur) => {
      return Math.abs(cur - px) < Math.abs(best - px) ? cur : best;
    }, fontSizePxOptions[0]);
    return String(nearest);
  },
  set(value) {
    const px = Number(value);
    if (!Number.isFinite(px) || px <= 0) return;
    const percent = Math.round((px / 16) * 100);
    updateSetting("uiFontSizePercent", percent as AppSettings["uiFontSizePercent"]);
  },
});
const percentOptions = Array.from({ length: 31 }, (_, i) => 50 + i * 5);
const fontSizePxOptions = Array.from({ length: 21 }, (_, i) => 12 + i);
const scaleOptionTone = (p: number) => (p === 100 ? "ffui-select-option--default" : p < 80 || p > 140 ? "ffui-select-option--extreme" : p >= 90 && p <= 120 ? "ffui-select-option--recommended" : ""), fontSizeOptionTone = (px: number) => (px === 16 ? "ffui-select-option--default" : px < 13 || px > 22 ? "ffui-select-option--extreme" : px >= 14 && px <= 20 ? "ffui-select-option--recommended" : "");
const systemFonts = ref<string[]>([]);
const systemFontsLoading = ref(false);
const openSourceFonts = ref<OpenSourceFontInfo[]>([]);
const openSourceFontsLoading = ref(false);
const refreshSystemFonts = async () => {
  if (!hasTauri()) return;
  systemFontsLoading.value = true;
  try {
    const raw = await fetchSystemFontFamilies();
    systemFonts.value = Array.from(new Set(raw)).sort((a, b) => a.localeCompare(b));
  } finally {
    systemFontsLoading.value = false;
  }
};
const ensureSystemFontsLoaded = async () => {
  if (!hasTauri()) return;
  if (systemFontsLoading.value) return;
  if (systemFonts.value.length > 0) return;
  await refreshSystemFonts();
};
onMounted(async () => {
  if (!hasTauri()) return;
  openSourceFontsLoading.value = true;
  try {
    openSourceFonts.value = await listOpenSourceFonts();
  } finally {
    openSourceFontsLoading.value = false;
  }
});
watch(
  () => props.appSettings,
  (s) => {
    if (!s) {
      uiFontModeSticky.value = "default";
      return;
    }
    if (s.uiFontFilePath) {
      uiFontModeSticky.value = "file";
      return;
    }
    if (s.uiFontDownloadId) {
      uiFontModeSticky.value = "openSource";
      return;
    }
    if (uiFontModeSticky.value === "file" || uiFontModeSticky.value === "openSource") {
      return;
    }
    if (typeof s.uiFontName === "string" && s.uiFontName.trim().length > 0) {
      uiFontModeSticky.value = "system";
      return;
    }
    uiFontModeSticky.value = "default";
  },
  { immediate: true },
);
const uiFontModeModel = computed<UiFontMode>({
  get() {
    const s = props.appSettings;
    if (!s) return "default";
    if (s.uiFontFilePath) return "file";
    if (s.uiFontDownloadId) return "openSource";
    // Keep the UI in "system font" mode even when the user temporarily clears
    // the input (so they can type a new font name without the UI jumping away).
    if (uiFontModeSticky.value === "file") return "file";
    if (uiFontModeSticky.value === "openSource") return "openSource";
    if (uiFontModeSticky.value === "system") return "system";
    return "default";
  },
  set(mode) {
    if (!props.appSettings) return;
    const next: AppSettings = { ...props.appSettings };
    uiFontModeSticky.value = mode;
    if (mode === "default") {
      next.uiFontFamily = "system";
      next.uiFontName = undefined;
      next.uiFontDownloadId = undefined;
      next.uiFontFilePath = undefined;
      next.uiFontFileSourceName = undefined;
    } else if (mode === "system") {
      next.uiFontFamily = "system";
      next.uiFontDownloadId = undefined;
      next.uiFontFilePath = undefined;
      next.uiFontFileSourceName = undefined;
    } else if (mode === "openSource") {
      next.uiFontFamily = "system";
      next.uiFontName = undefined;
      next.uiFontDownloadId = next.uiFontDownloadId ?? openSourceFonts.value[0]?.id ?? undefined;
      next.uiFontFilePath = undefined;
      next.uiFontFileSourceName = undefined;
      if (next.uiFontDownloadId) {
        const entry = openSourceFonts.value.find((f) => f.id === next.uiFontDownloadId);
        if (entry) next.uiFontName = entry.familyName;
      }
    } else if (mode === "file") {
      next.uiFontFamily = "system";
      next.uiFontDownloadId = undefined;
    }
    emit("update:appSettings", next);
  },
});
const uiSystemFontDraft = ref("");
const systemFontFocused = ref(false);
let systemFontCommitTimer: number | undefined;
const commitSystemFontNameNow = () => {
  if (!props.appSettings) return;
  if (systemFontCommitTimer !== undefined) {
    window.clearTimeout(systemFontCommitTimer);
    systemFontCommitTimer = undefined;
  }
  const normalized = uiSystemFontDraft.value.trim();
  const resolved = resolveSystemFontFamilyName({
    fonts: systemFonts.value,
    input: normalized,
  });
  emit("update:appSettings", {
    ...props.appSettings,
    uiFontFamily: "system",
    uiFontName: resolved || undefined,
    uiFontDownloadId: undefined,
    uiFontFilePath: undefined,
    uiFontFileSourceName: undefined,
  });
};
const scheduleCommitSystemFontName = (value: string) => {
  uiSystemFontDraft.value = value;
  if (systemFontCommitTimer !== undefined) {
    window.clearTimeout(systemFontCommitTimer);
  }
  systemFontCommitTimer = window.setTimeout(() => {
    commitSystemFontNameNow();
  }, 300);
};
watch(
  () => props.appSettings?.uiFontName ?? "",
  (value) => {
    uiSystemFontDraft.value = value ?? "";
  },
  { immediate: true },
);
const systemFontSuggestions = computed(() =>
  getSystemFontSuggestions({
    fonts: systemFonts.value,
    query: uiSystemFontDraft.value,
    focused: systemFontFocused.value,
    max: 20,
  }),
);
const uiOpenSourceFontIdModel = computed<string>({
  get() {
    return props.appSettings?.uiFontDownloadId ?? "";
  },
  set(value) {
    if (!props.appSettings) return;
    const id = String(value ?? "").trim();
    const entry = openSourceFonts.value.find((f) => f.id === id);
    const next: AppSettings = {
      ...props.appSettings,
      uiFontFamily: "system",
      uiFontDownloadId: id || undefined,
      uiFontName: entry?.familyName ?? props.appSettings.uiFontName,
      uiFontFilePath: undefined,
      uiFontFileSourceName: undefined,
    };
    emit("update:appSettings", next);
  },
});
const uiFontFileBusy = ref(false);
const uiFontFileError = ref<string | null>(null);
const getFontFileBasename = (p?: string | null) => {
  const value = (p ?? "").trim();
  if (!value) return "";
  const parts = value.split(/[/\\]/g);
  return parts[parts.length - 1] ?? value;
};
const chooseUiFontFile = async () => {
  if (!props.appSettings) return;
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
  if (!props.appSettings) return;
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
  <Card class="border-border/50 bg-card/95 shadow-sm" :data-locale="locale">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.appearanceTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 space-y-2">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.appearanceDescription") }}
      </p>
      <div class="grid grid-cols-2 gap-2">
        <div class="space-y-2">
          <div class="space-y-1">
            <p class="text-xs font-medium text-foreground">{{ t("app.settings.uiScaleLabel") }}</p>
            <Select v-model="uiScalePercentModel">
              <SelectTrigger class="h-7 text-[11px] bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in percentOptions" :key="p" :value="String(p)" class="text-[11px]" :class="scaleOptionTone(p)">{{ p }}%</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[9px] text-muted-foreground leading-snug">{{ t("app.settings.uiScaleHelp") }}</p>
          </div>
          <div class="space-y-1">
            <p class="text-xs font-medium text-foreground">{{ t("app.settings.uiFontSizeLabel") }}</p>
            <Select v-model="uiFontSizePxModel">
              <SelectTrigger class="h-7 text-[11px] bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="px in fontSizePxOptions" :key="px" :value="String(px)" class="text-[11px]" :class="fontSizeOptionTone(px)">{{ px }}px</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[9px] text-muted-foreground leading-snug">{{ t("app.settings.uiFontSizeHelp") }}</p>
          </div>
        </div>
        <div class="space-y-1">
          <p class="text-xs font-medium text-foreground">
            {{ t("app.settings.uiFontModeLabel") }}
          </p>
          <Select v-model="uiFontModeModel">
            <SelectTrigger class="h-7 text-[11px] bg-background/50 border-border/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" class="text-[11px]">
                {{ t("app.settings.uiFontModes.default") }}
              </SelectItem>
              <SelectItem value="system" class="text-[11px]">
                {{ t("app.settings.uiFontModes.system") }}
              </SelectItem>
              <SelectItem value="openSource" class="text-[11px]">
                {{ t("app.settings.uiFontModes.openSource") }}
              </SelectItem>
              <SelectItem value="file" class="text-[11px]">
                {{ t("app.settings.uiFontModes.file") }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[9px] text-muted-foreground leading-snug">
            {{ t("app.settings.uiFontModeHelp") }}
          </p>
        </div>
      </div>
      <div v-if="uiFontModeModel === 'system'" class="space-y-1">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-foreground">
            {{ t("app.settings.uiSystemFontLabel") }}
          </p>
          <Button
            v-if="hasTauri()"
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            :disabled="systemFontsLoading"
            @click="refreshSystemFonts"
          >
            {{ systemFontsLoading ? t("app.settings.loadingFonts") : t("app.settings.refreshFonts") }}
          </Button>
        </div>
        <div class="relative">
          <Input
            :model-value="uiSystemFontDraft"
            class="h-7 text-[11px] bg-background/50 border-border/30"
            :placeholder="t('app.settings.uiSystemFontPlaceholder')"
            @focus="
              () => {
                systemFontFocused = true;
                ensureSystemFontsLoaded();
              }
            "
            @update:model-value="(v) => scheduleCommitSystemFontName(String(v ?? ''))"
            @blur="
              () => {
                commitSystemFontNameNow();
                systemFontFocused = false;
              }
            "
            @keydown.enter.prevent="commitSystemFontNameNow"
          />
          <div
            v-if="!systemFontsLoading && systemFontSuggestions.length > 0"
            class="absolute z-50 mt-1 w-full rounded border border-border/40 bg-popover shadow-sm max-h-40 overflow-auto"
          >
            <button
              v-for="suggestion in systemFontSuggestions"
              :key="suggestion.value"
              type="button"
              class="w-full text-left px-2 py-1 text-[11px] hover:bg-accent/10"
              @mousedown.prevent="
                () => {
                  uiSystemFontDraft = suggestion.value;
                  commitSystemFontNameNow();
                  systemFontFocused = false;
                }
              "
            >
              {{ suggestion.label }}
            </button>
          </div>
        </div>
        <p class="text-[9px] text-muted-foreground leading-snug">
          {{ t("app.settings.uiSystemFontHelp") }}
        </p>
      </div>
      <div v-else-if="uiFontModeModel === 'openSource'" class="space-y-1">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-foreground">
            {{ t("app.settings.uiOpenSourceFontLabel") }}
          </p>
          <span v-if="openSourceFontsLoading" class="text-[9px] text-muted-foreground">
            {{ t("app.settings.loadingFonts") }}
          </span>
        </div>
        <Select v-model="uiOpenSourceFontIdModel">
          <SelectTrigger class="h-7 text-[11px] bg-background/50 border-border/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="f in openSourceFonts" :key="f.id" :value="f.id" class="text-[11px]">{{ f.name }}</SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[9px] text-muted-foreground leading-snug">
          {{ t("app.settings.uiOpenSourceFontHelp") }}
        </p>
        <SettingsOpenSourceFontDownloadStatus :font-id="appSettings.uiFontDownloadId ?? null" />
      </div>
      <div v-else-if="uiFontModeModel === 'file'" class="space-y-1">
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
              v-if="hasTauri() && appSettings.uiFontFilePath"
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
          <span v-if="appSettings.uiFontFilePath">
            {{ t("app.settings.currentFontFileLabel") }}
            <span class="font-mono text-foreground">{{ getFontFileBasename(appSettings.uiFontFileSourceName || appSettings.uiFontFilePath) }}</span>
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

      <div class="flex items-center justify-between gap-2 pt-1">
        <p class="text-[10px] text-muted-foreground">
          {{ t("app.settings.uiAppearancePreview") }}
          <span class="font-semibold text-foreground">FFUI</span>
          <span class="opacity-80"> — 123.45 MB / 00:01:23</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px]"
          data-testid="settings-reset-ui-appearance"
          @click="
            () => {
              updateSetting('uiScalePercent', 100);
              updateSetting('uiFontSizePercent', 100);
              updateSetting('uiFontFamily', 'system');
              updateSetting('uiFontName', undefined);
              updateSetting('uiFontDownloadId', undefined);
              updateSetting('uiFontFilePath', undefined);
              updateSetting('uiFontFileSourceName', undefined);
            }
          "
        >
          {{ t("app.settings.resetUiAppearanceButton") }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
