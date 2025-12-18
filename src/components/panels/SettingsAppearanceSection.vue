<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, ComboboxAnchor, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import type { AppSettings } from "@/types";
import SettingsOpenSourceFontDownloadStatus from "@/components/panels/SettingsOpenSourceFontDownloadStatus.vue";
import { getSystemFontSuggestions, resolveSystemFontFamilyName, type SystemFontFamily } from "@/lib/systemFontSearch";
import SettingsAppearanceUiFontFilePicker from "@/components/panels/SettingsAppearanceUiFontFilePicker.vue";
import { fetchSystemFontFamilies, hasTauri, listOpenSourceFonts, type OpenSourceFontInfo } from "@/lib/backend";
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
const scaleOptionTone = (p: number) =>
    p === 100
      ? "ffui-select-option--default"
      : p < 80 || p > 140
        ? "ffui-select-option--extreme"
        : p >= 90 && p <= 120
          ? "ffui-select-option--recommended"
          : "",
  fontSizeOptionTone = (px: number) =>
    px === 16
      ? "ffui-select-option--default"
      : px < 13 || px > 22
        ? "ffui-select-option--extreme"
        : px >= 14 && px <= 20
          ? "ffui-select-option--recommended"
          : "";
const systemFonts = ref<SystemFontFamily[]>([]);
const systemFontsLoading = ref(false);
const openSourceFonts = ref<OpenSourceFontInfo[]>([]);
const openSourceFontsLoading = ref(false);
const refreshSystemFonts = async () => {
  if (!hasTauri()) return;
  systemFontsLoading.value = true;
  try {
    const raw = await fetchSystemFontFamilies();
    const byPrimary = new Map<string, SystemFontFamily>();
    const normalizeKey = (value: string) => value.trim().toLowerCase();
    for (const entry of Array.isArray(raw) ? raw : []) {
      const primary = String(entry.primary ?? "").trim();
      if (!primary) continue;
      const names = Array.isArray(entry.names) ? entry.names : [];
      const key = normalizeKey(primary);
      const existing = byPrimary.get(key);
      if (!existing) {
        byPrimary.set(key, { primary, names: names.slice() });
        continue;
      }
      existing.names = Array.from(
        new Map(
          existing.names
            .concat(names)
            .map((name) => String(name ?? "").trim())
            .filter((name) => name.length > 0)
            .map((name) => [normalizeKey(name), name] as const),
        ).values(),
      );
    }
    systemFonts.value = Array.from(byPrimary.values()).sort((a, b) => a.primary.localeCompare(b.primary));
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
    // When the user clears the input (e.g. holding backspace) we still want to
    // keep the UI in "system font" mode, so the input doesn't disappear and
    // the mode selector doesn't bounce back to "default" mid-edit.
    if (uiFontModeSticky.value === "system") {
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
const systemFontSuggestionsSuppressed = ref(false);
let systemFontCommitTimer: number | undefined;
const resetUiAppearance = () => {
  if (!props.appSettings) return;
  uiFontModeSticky.value = "default";
  systemFontFocused.value = false;
  systemFontSuggestionsSuppressed.value = false;
  uiSystemFontDraft.value = "";
  emit("update:appSettings", {
    ...props.appSettings,
    uiScalePercent: 100,
    uiFontSizePercent: 100,
    uiFontFamily: "system",
    uiFontName: undefined,
    uiFontDownloadId: undefined,
    uiFontFilePath: undefined,
    uiFontFileSourceName: undefined,
  });
};
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
  systemFontFocused.value = true;
  // When selecting a suggestion, reka-ui will also update the input value.
  // Keep the suggestions suppressed if the new value is identical to the current draft,
  // so the list closes after selection but reopens on subsequent edits.
  const previousDraft = uiSystemFontDraft.value;
  if (systemFontSuggestionsSuppressed.value) {
    if (value !== previousDraft) {
      systemFontSuggestionsSuppressed.value = false;
    }
  } else {
    systemFontSuggestionsSuppressed.value = false;
  }
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
    focused: systemFontFocused.value && !systemFontSuggestionsSuppressed.value,
    max: 20,
  }),
);

const onSystemFontSuggestionSelected = (value: string) => {
  uiSystemFontDraft.value = value;
  systemFontSuggestionsSuppressed.value = true;
  commitSystemFontNameNow();
};
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
                <SelectItem
                  v-for="p in percentOptions"
                  :key="p"
                  :value="String(p)"
                  class="text-[11px]"
                  :class="scaleOptionTone(p)"
                  >{{ p }}%</SelectItem
                >
              </SelectContent>
            </Select>
            <p class="text-[9px] text-muted-foreground leading-snug">{{ t("app.settings.uiScaleHelp") }}</p>
          </div>
          <div class="space-y-1">
            <p class="text-xs font-medium text-foreground">{{ t("app.settings.uiFontSizeLabel") }}</p>
            <Select v-model="uiFontSizePxModel">
              <SelectTrigger class="h-7 text-[11px] bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="px in fontSizePxOptions"
                  :key="px"
                  :value="String(px)"
                  class="text-[11px]"
                  :class="fontSizeOptionTone(px)"
                  >{{ px }}px</SelectItem
                >
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
            <SelectTrigger
              data-testid="settings-ui-font-mode-trigger"
              class="h-7 text-[11px] bg-background/50 border-border/30"
            >
              <SelectValue>{{ t(`app.settings.uiFontModes.${uiFontModeModel}`) }}</SelectValue>
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
          <Combobox
            :open="
              !systemFontsLoading &&
              systemFontSuggestions.length > 0 &&
              systemFontFocused &&
              !systemFontSuggestionsSuppressed
            "
            :model-value="appSettings?.uiFontName ?? ''"
            @update:model-value="(v) => onSystemFontSuggestionSelected(String(v ?? ''))"
          >
            <ComboboxAnchor class="w-full">
              <ComboboxInput
                data-testid="settings-ui-system-font-input"
                :model-value="uiSystemFontDraft"
                class="h-7 text-[11px] bg-background/50 border-border/30"
                :placeholder="t('app.settings.uiSystemFontPlaceholder')"
                @focus="
                  () => {
                    systemFontFocused = true;
                    systemFontSuggestionsSuppressed = false;
                    ensureSystemFontsLoaded();
                  }
                "
                @update:model-value="(v) => scheduleCommitSystemFontName(String(v ?? ''))"
                @blur="
                  () => {
                    commitSystemFontNameNow();
                    systemFontFocused = false;
                    systemFontSuggestionsSuppressed = false;
                  }
                "
                @keydown.enter.prevent="commitSystemFontNameNow"
              />
            </ComboboxAnchor>
            <ComboboxList
              data-testid="settings-ui-system-font-suggestions"
              class="mt-1 w-[--reka-popper-anchor-width] max-h-40 overflow-auto border-border/40"
              :side-offset="4"
            >
              <ComboboxItem
                v-for="suggestion in systemFontSuggestions"
                :key="suggestion.value"
                :value="suggestion.value"
                class="px-2 py-1 text-[11px]"
                @select="() => onSystemFontSuggestionSelected(suggestion.value)"
              >
                {{ suggestion.label }}
              </ComboboxItem>
            </ComboboxList>
          </Combobox>
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
            <SelectItem v-for="f in openSourceFonts" :key="f.id" :value="f.id" class="text-[11px]">{{
              f.name
            }}</SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[9px] text-muted-foreground leading-snug">
          {{ t("app.settings.uiOpenSourceFontHelp") }}
        </p>
        <SettingsOpenSourceFontDownloadStatus :font-id="appSettings.uiFontDownloadId ?? null" />
      </div>
      <SettingsAppearanceUiFontFilePicker
        v-else-if="uiFontModeModel === 'file' && appSettings"
        :app-settings="appSettings"
        @update:appSettings="emit('update:appSettings', $event)"
      />

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
          @click="resetUiAppearance"
        >
          {{ t("app.settings.resetUiAppearanceButton") }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
