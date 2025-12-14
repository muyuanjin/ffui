<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.taskbarProgressModeLabel") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2">
      <Select
        :model-value="appSettings.taskbarProgressMode"
        @update:model-value="(v) => updateSetting('taskbarProgressMode', v as AppSettings['taskbarProgressMode'])"
      >
        <SelectTrigger class="h-7 text-[10px] bg-background/50 border-border/30">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="bySize" class="text-[10px]">
            {{ t("app.taskbarProgressModes.bySize") }}
          </SelectItem>
          <SelectItem value="byDuration" class="text-[10px]">
            {{ t("app.taskbarProgressModes.byDuration") }}
          </SelectItem>
          <SelectItem value="byEstimatedTime" class="text-[10px]">
            {{ t("app.taskbarProgressModes.byEstimatedTime") }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p class="text-[9px] text-muted-foreground mt-1.5 leading-relaxed">
        {{ t("app.taskbarProgressModeHelp") }}
      </p>
      <div class="mt-3 space-y-1">
        <p class="text-[10px] font-medium text-foreground">
          {{ t("app.taskbarProgressScopeLabel") }}
        </p>
        <Select
          :model-value="appSettings.taskbarProgressScope ?? 'allJobs'"
          @update:model-value="
            (v) => updateSetting('taskbarProgressScope', v as AppSettings['taskbarProgressScope'])
          "
        >
          <SelectTrigger class="h-7 text-[10px] bg-background/50 border-border/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="allJobs" class="text-[10px]">
              {{ t('app.taskbarProgressScopes.allJobs') }}
            </SelectItem>
            <SelectItem value="activeAndQueued" class="text-[10px]">
              {{ t('app.taskbarProgressScopes.activeAndQueued') }}
            </SelectItem>
          </SelectContent>
        </Select>
        <p class="text-[9px] text-muted-foreground leading-relaxed">
          {{ t("app.taskbarProgressScopeHelp") }}
        </p>
      </div>
    </CardContent>
  </Card>
</template>

