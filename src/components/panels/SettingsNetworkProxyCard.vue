<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SettingsNetworkProxySection from "@/components/panels/settings-engine/SettingsNetworkProxySection.vue";
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
  <Card class="border-border/50 bg-card/95 shadow-sm" data-testid="settings-card-network-proxy">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.networkProxyTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent v-if="appSettings" class="p-2">
      <SettingsNetworkProxySection
        :app-settings="appSettings"
        @update:app-settings="(s) => emit('update:appSettings', s)"
      />
    </CardContent>
  </Card>
</template>
