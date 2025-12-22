<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SettingsQueuePersistenceSection from "@/components/panels/SettingsQueuePersistenceSection.vue";
import SettingsExitAutoWaitSection from "@/components/panels/SettingsExitAutoWaitSection.vue";
import type { AppSettings } from "@/types";

defineProps<{
  appSettings: AppSettings | null;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-queue-recovery">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.queueRecoveryTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2 flex flex-col gap-2">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.queueRecoveryDescription") }}
      </p>
      <SettingsQueuePersistenceSection
        :app-settings="appSettings"
        :hide-title="true"
        @update:app-settings="(settings) => emit('update:appSettings', settings)"
      />
      <SettingsExitAutoWaitSection
        :app-settings="appSettings"
        @update:app-settings="(settings) => emit('update:appSettings', settings)"
      />
    </CardContent>
  </Card>
</template>
