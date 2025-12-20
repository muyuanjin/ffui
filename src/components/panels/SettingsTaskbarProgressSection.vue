<script setup lang="ts">
import { computed } from "vue";
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

const taskbarProgressModeLabelKey = computed(() => {
  const mode = props.appSettings?.taskbarProgressMode ?? "byEstimatedTime";
  return `app.taskbarProgressModes.${mode}`;
});

const taskbarProgressScopeLabelKey = computed(() => {
  const scope = props.appSettings?.taskbarProgressScope ?? "allJobs";
  return `app.taskbarProgressScopes.${scope}`;
});

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  if (!props.appSettings) return;
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-progress-display">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.progressDisplayTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col flex-1">
      <div class="flex flex-col flex-1 justify-between gap-3">
        <div>
          <Select
            :model-value="appSettings.taskbarProgressMode"
            @update:model-value="(v) => updateSetting('taskbarProgressMode', v as AppSettings['taskbarProgressMode'])"
          >
            <SelectTrigger
              class="h-7 text-[10px] bg-background/50 border-border/30"
              data-testid="settings-taskbar-progress-mode-trigger"
            >
              <SelectValue>{{ t(taskbarProgressModeLabelKey) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bySize" class="text-[10px]" data-testid="settings-taskbar-progress-mode-by-size">
                {{ t("app.taskbarProgressModes.bySize") }}
              </SelectItem>
              <SelectItem
                value="byDuration"
                class="text-[10px]"
                data-testid="settings-taskbar-progress-mode-by-duration"
              >
                {{ t("app.taskbarProgressModes.byDuration") }}
              </SelectItem>
              <SelectItem
                value="byEstimatedTime"
                class="text-[10px]"
                data-testid="settings-taskbar-progress-mode-by-estimated-time"
              >
                {{ t("app.taskbarProgressModes.byEstimatedTime") }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[9px] text-muted-foreground mt-1.5 leading-relaxed">
            {{ t("app.taskbarProgressModeHelp") }}
          </p>
        </div>

        <div class="space-y-1">
          <p class="text-[10px] font-medium text-foreground">
            {{ t("app.taskbarProgressScopeLabel") }}
          </p>
          <Select
            :model-value="appSettings.taskbarProgressScope ?? 'allJobs'"
            @update:model-value="(v) => updateSetting('taskbarProgressScope', v as AppSettings['taskbarProgressScope'])"
          >
            <SelectTrigger
              class="h-7 text-[10px] bg-background/50 border-border/30"
              data-testid="settings-taskbar-progress-scope-trigger"
            >
              <SelectValue>{{ t(taskbarProgressScopeLabelKey) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allJobs" class="text-[10px]" data-testid="settings-taskbar-progress-scope-all-jobs">
                {{ t("app.taskbarProgressScopes.allJobs") }}
              </SelectItem>
              <SelectItem
                value="activeAndQueued"
                class="text-[10px]"
                data-testid="settings-taskbar-progress-scope-active-and-queued"
              >
                {{ t("app.taskbarProgressScopes.activeAndQueued") }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-[9px] text-muted-foreground leading-relaxed">
            {{ t("app.taskbarProgressScopeHelp") }}
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
