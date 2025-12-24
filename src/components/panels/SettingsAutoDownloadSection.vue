<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

type ExternalToolsMode = "autoManaged" | "installOnly" | "manual" | "custom";
const toolsMode = computed<ExternalToolsMode>({
  get() {
    const tools = props.appSettings?.tools;
    if (!tools) return "autoManaged";
    const { autoDownload, autoUpdate } = tools;
    if (autoDownload && autoUpdate) return "autoManaged";
    if (autoDownload && !autoUpdate) return "installOnly";
    if (!autoDownload && !autoUpdate) return "manual";
    return "custom";
  },
  set(mode) {
    if (!props.appSettings) return;
    if (mode === "custom") return;
    const next: AppSettings = {
      ...props.appSettings,
      tools: { ...props.appSettings.tools },
    };
    if (mode === "autoManaged") {
      next.tools.autoDownload = true;
      next.tools.autoUpdate = true;
    } else if (mode === "installOnly") {
      next.tools.autoDownload = true;
      next.tools.autoUpdate = false;
    } else if (mode === "manual") {
      next.tools.autoDownload = false;
      next.tools.autoUpdate = false;
    }
    emit("update:appSettings", next);
  },
});

const updateToolsMode = (value: unknown) => {
  if (value === "autoManaged" || value === "installOnly" || value === "manual" || value === "custom") {
    toolsMode.value = value;
  }
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-auto-download">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.autoDownloadSectionTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col gap-2 flex-1">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.autoDownloadSectionDescription") }}
      </p>

      <div class="flex flex-col gap-1 flex-1">
        <p class="text-[9px] text-muted-foreground uppercase tracking-wider">
          {{ t("app.settings.downloadStrategyLabel") }}
        </p>

        <RadioGroup
          data-testid="settings-auto-download-mode-group"
          class="grid auto-rows-min content-between gap-0.5 flex-1"
          :model-value="toolsMode"
          @update:model-value="updateToolsMode"
        >
          <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <RadioGroupItem
              id="external-tools-mode-auto-managed"
              data-testid="external-tools-mode-auto-managed"
              value="autoManaged"
              class="mt-[2px] h-3 w-3 border-border/50"
            />
            <div class="flex-1 flex flex-col gap-0.5">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] select-none">
                  {{ t("app.settings.toolModeAutoManagedLabel") }}
                </span>
                <span
                  class="inline-flex items-center px-1 py-[1px] rounded-full text-[8px] font-medium bg-primary/10 text-primary border border-primary/30"
                >
                  {{ t("app.settings.toolModeRecommendedBadge") }}
                </span>
              </div>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.toolModeAutoManagedDescription") }}
              </p>
            </div>
          </label>

          <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <RadioGroupItem
              id="external-tools-mode-install-only"
              data-testid="external-tools-mode-install-only"
              value="installOnly"
              class="mt-[2px] h-3 w-3 border-border/50"
            />
            <div class="flex-1 flex flex-col gap-0.5">
              <span class="text-[10px] select-none">
                {{ t("app.settings.toolModeInstallOnlyLabel") }}
              </span>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.toolModeInstallOnlyDescription") }}
              </p>
            </div>
          </label>

          <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
            <RadioGroupItem
              id="external-tools-mode-manual"
              data-testid="external-tools-mode-manual"
              value="manual"
              class="mt-[2px] h-3 w-3 border-border/50"
            />
            <div class="flex-1 flex flex-col gap-0.5">
              <span class="text-[10px] select-none">
                {{ t("app.settings.toolModeManualLabel") }}
              </span>
              <p class="text-[9px] text-muted-foreground leading-snug">
                {{ t("app.settings.toolModeManualDescription") }}
              </p>
            </div>
          </label>
        </RadioGroup>

        <div
          v-if="toolsMode === 'custom'"
          data-testid="tools-mode-custom-hint"
          class="rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-1"
        >
          <p class="text-[9px] leading-snug text-amber-700 dark:text-amber-400">
            <span class="font-semibold"> {{ t("app.settings.toolModeCustomLabel") }}： </span>
            {{ t("app.settings.toolModeCustomDescription") }}
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
