<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cleanupPreviewCachesAsync, hasTauri } from "@/lib/backend";
import type { AppSettings } from "@/types";

const { t } = useI18n();

type PreviewCacheCleanupStatus = "idle" | "cleaning" | "started" | "not-started" | "error";

const previewCacheCleanupStatus = ref<PreviewCacheCleanupStatus>("idle");
const previewCacheCleanupTooltip = ref<string | null>(null);
let previewCacheCleanupTimer: number | null = null;

const props = defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};

const previewCacheButtonLabel = computed(() => {
  if (previewCacheCleanupStatus.value === "cleaning") {
    return t("app.settings.previewCacheCleaning");
  }
  if (previewCacheCleanupStatus.value === "started") {
    return t("app.settings.previewCacheCleanupStartedButton");
  }
  if (previewCacheCleanupStatus.value === "not-started") {
    return t("app.settings.previewCacheCleanupNotStartedButton");
  }
  if (previewCacheCleanupStatus.value === "error") {
    return t("app.settings.previewCacheCleanupErrorButton");
  }
  return t("app.settings.previewCacheCleanupButton");
});

const previewCacheButtonClass = computed(() => {
  if (previewCacheCleanupStatus.value === "started") {
    return "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (previewCacheCleanupStatus.value === "not-started" || previewCacheCleanupStatus.value === "error") {
    return "border-destructive/60 text-destructive hover:bg-destructive/10";
  }
  return "";
});

const cleanupPreviewCache = async () => {
  if (!hasTauri()) return;
  if (previewCacheCleanupStatus.value === "cleaning") return;
  previewCacheCleanupStatus.value = "cleaning";
  previewCacheCleanupTooltip.value = null;

  try {
    const started = await cleanupPreviewCachesAsync();
    previewCacheCleanupStatus.value = started ? "started" : "not-started";
    previewCacheCleanupTooltip.value = started
      ? (t("app.settings.previewCacheCleanupStarted") as string)
      : (t("app.settings.previewCacheCleanupNotStarted") as string);
  } catch (error) {
    previewCacheCleanupStatus.value = "error";
    previewCacheCleanupTooltip.value = (error as Error)?.message ?? String(error);
  } finally {
    if (previewCacheCleanupTimer != null) {
      window.clearTimeout(previewCacheCleanupTimer);
      previewCacheCleanupTimer = null;
    }
    previewCacheCleanupTimer = window.setTimeout(() => {
      previewCacheCleanupStatus.value = "idle";
      previewCacheCleanupTooltip.value = null;
      previewCacheCleanupTimer = null;
    }, 2500);
  }
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-preview">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.previewCacheSectionTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col gap-2 flex-1">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.previewCacheSectionDescription") }}
      </p>

      <div class="flex flex-col flex-1 justify-between gap-2">
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <label class="text-[11px] font-medium text-foreground">
              {{ t("app.settings.previewCaptureLabel") }}
            </label>
            <div class="flex items-center justify-end gap-1 w-28 whitespace-nowrap">
              <Input
                :model-value="appSettings.previewCapturePercent"
                type="number"
                min="0"
                max="100"
                data-testid="settings-preview-capture-percent"
                class="w-20 h-6 text-[10px] font-mono text-center"
                @update:model-value="(v) => updateSetting('previewCapturePercent', Number(v))"
              />
              <span class="text-[10px] text-muted-foreground text-right w-6">%</span>
            </div>
          </div>
          <p class="text-[9px] text-muted-foreground leading-snug">
            {{ t("app.settings.previewCaptureHelp") }}
          </p>
        </div>

        <div class="pt-2 border-t border-border/30 flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">
            {{ hasTauri() ? t("app.settings.previewCacheSectionHint") : t("app.openDevtoolsUnavailable") }}
          </span>
          <Button
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            :class="previewCacheButtonClass"
            data-testid="settings-cleanup-preview-cache"
            :disabled="!hasTauri() || previewCacheCleanupStatus === 'cleaning'"
            :title="previewCacheCleanupTooltip ?? undefined"
            @click="cleanupPreviewCache"
          >
            {{ previewCacheButtonLabel }}
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
