<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "vue-i18n";
import { hasTauri, openDevtools } from "@/lib/backend";
import SettingsAppUpdatesSection from "@/components/panels/SettingsAppUpdatesSection.vue";
import SettingsAppearanceSection from "@/components/panels/SettingsAppearanceSection.vue";
import SettingsAutoDownloadSection from "@/components/panels/SettingsAutoDownloadSection.vue";
import SettingsNetworkProxyCard from "@/components/panels/SettingsNetworkProxyCard.vue";
import SettingsPerformanceConcurrencySection from "@/components/panels/SettingsPerformanceConcurrencySection.vue";
import SettingsRefreshFrequencySection from "@/components/panels/SettingsRefreshFrequencySection.vue";
import SettingsQueueRecoverySection from "@/components/panels/SettingsQueueRecoverySection.vue";
import SettingsExternalToolsSection from "@/components/panels/SettingsExternalToolsSection.vue";
import SettingsPreviewSection from "@/components/panels/SettingsPreviewSection.vue";
import SettingsDataStorageSection from "@/components/panels/SettingsDataStorageSection.vue";
import SettingsTaskbarProgressSection from "@/components/panels/SettingsTaskbarProgressSection.vue";
import SettingsCommunitySection from "@/components/panels/SettingsCommunitySection.vue";
import SettingsPresetCardFooterSection from "@/components/panels/SettingsPresetCardFooterSection.vue";
import type { AppSettings, ExternalToolCandidate, ExternalToolKind, ExternalToolStatus } from "@/types";
type AppUpdateUiState = {
  configured?: boolean | null;
  autoCheckDefault?: boolean;
  available: boolean;
  checking: boolean;
  installing: boolean;
  availableVersion: string | null;
  availableBody: string | null;
  currentVersion: string | null;
  lastCheckedAtMs: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
};
const props = withDefaults(
  defineProps<{
    /** Application settings */
    appSettings: AppSettings | null;
    /** External tool statuses */
    toolStatuses: ExternalToolStatus[];
    /** Whether tool statuses have been refreshed at least once this session. */
    toolStatusesFresh?: boolean;
    /** Trigger an async tool status refresh (non-blocking). */
    refreshToolStatuses?: (options?: {
      remoteCheck?: boolean;
      manualRemoteCheck?: boolean;
      remoteCheckKind?: ExternalToolKind;
    }) => Promise<void>;
    /** App updater UI state snapshot. */
    appUpdate?: AppUpdateUiState;
    /** Manually trigger an app update check. */
    checkForAppUpdate?: (options?: { force?: boolean }) => Promise<void>;
    /** Download and install the currently available update. */
    installAppUpdate?: () => Promise<void>;
    /** Whether settings are being saved */
    isSavingSettings: boolean;
    /** Settings save error message */
    settingsSaveError: string | null;
    /** Reload presets from backend after data imports. */
    reloadPresets?: () => Promise<void>;
    /** Fetch available candidate binaries for a tool kind. */
    fetchToolCandidates: (kind: ExternalToolKind) => Promise<ExternalToolCandidate[]>;
  }>(),
  {
    toolStatusesFresh: true,
    refreshToolStatuses: undefined,
    appUpdate: () => ({
      available: false,
      checking: false,
      installing: false,
      availableVersion: null,
      availableBody: null,
      currentVersion: null,
      lastCheckedAtMs: null,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    }),
    checkForAppUpdate: undefined,
    installAppUpdate: undefined,
    reloadPresets: undefined,
  },
);

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
  downloadTool: [kind: ExternalToolKind];
}>();

const { t } = useI18n();

const systemStatus = computed(() => {
  if (props.isSavingSettings) {
    return { text: "SAVING...", className: "text-yellow-500" };
  }
  if (props.settingsSaveError) {
    return { text: "ERROR", className: "text-red-500" };
  }
  return { text: "READY", className: "text-emerald-500" };
});
</script>

<template>
  <section class="max-w-7xl mx-auto px-3 py-2 min-h-full flex flex-col" data-testid="settings-panel">
    <div class="grid gap-2 items-stretch lg:grid-cols-12 grow shrink-0" data-testid="settings-panel-grid">
      <div class="lg:col-span-8 flex flex-col gap-2" data-testid="settings-left-column">
        <SettingsExternalToolsSection
          :app-settings="appSettings"
          :tool-statuses="toolStatuses"
          :tool-statuses-fresh="toolStatusesFresh"
          :fetch-tool-candidates="fetchToolCandidates"
          :refresh-tool-statuses="refreshToolStatuses"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
          @downloadTool="(kind) => emit('downloadTool', kind)"
        />

        <SettingsAutoDownloadSection
          class="lg:flex-[1]"
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsNetworkProxyCard
          :app-settings="appSettings"
          @update:app-settings="(s) => emit('update:appSettings', s)"
        />

        <SettingsPerformanceConcurrencySection
          class="lg:flex-[2]"
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsQueueRecoverySection
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsDataStorageSection
          class="lg:flex-[4]"
          :reload-presets="reloadPresets"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />
      </div>

      <div class="lg:col-span-4 flex flex-col gap-2" data-testid="settings-right-column">
        <SettingsAppUpdatesSection
          :app-settings="appSettings"
          :app-update="appUpdate"
          :check-for-app-update="checkForAppUpdate"
          :install-app-update="installAppUpdate"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsAppearanceSection
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsPresetCardFooterSection
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsPreviewSection
          class="lg:flex-1"
          :app-settings="appSettings"
          @update:app-settings="(s) => emit('update:appSettings', s)"
        />

        <SettingsTaskbarProgressSection
          class="lg:flex-1"
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsRefreshFrequencySection
          class="lg:flex-1"
          :app-settings="appSettings"
          @update:app-settings="(settings) => emit('update:appSettings', settings)"
        />

        <SettingsCommunitySection />

        <Card class="border-border/50 bg-card/95 shadow-sm" data-testid="settings-card-devtools">
          <CardHeader class="py-2 px-3 border-b border-border/30">
            <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              {{ t("app.settings.devtoolsSectionTitle") }}
            </CardTitle>
          </CardHeader>
          <CardContent class="p-2">
            <div class="flex items-center justify-between">
              <p class="text-[10px] text-muted-foreground">
                {{ hasTauri() ? t("app.settings.devtoolsWindowHint") : t("app.openDevtoolsUnavailable") }}
              </p>
              <Button
                variant="outline"
                size="sm"
                class="h-6 px-2 text-[10px]"
                data-testid="settings-open-devtools"
                :disabled="!hasTauri()"
                @click="openDevtools"
              >
                {{ t("app.openDevtools") }}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    <div
      v-if="appSettings"
      class="mt-3 px-2 py-1 bg-muted/30 rounded border border-border/30"
      data-testid="settings-status-bar"
    >
      <div class="space-y-1">
        <p class="text-[9px] font-mono text-muted-foreground text-center">
          <span v-if="isSavingSettings" class="text-yellow-500">● SAVING SETTINGS...</span>
          <span v-else-if="settingsSaveError" class="text-red-500">● {{ settingsSaveError }}</span>
          <span v-else class="text-emerald-500">● {{ t("app.settings.autoSaveHint") }}</span>
        </p>
        <div
          class="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground"
        >
          <span class="flex items-center gap-1">
            <span class="opacity-60">PLATFORM:</span>
            <span>{{ hasTauri() ? "TAURI" : "WEB" }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="opacity-60">SETTINGS:</span>
            <span class="text-primary">{{ appSettings ? "LOADED" : "LOADING..." }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="opacity-60">STATUS:</span>
            <span :class="systemStatus.className">{{ systemStatus.text }}</span>
          </span>
        </div>
      </div>
    </div>

    <div v-if="!appSettings" class="flex items-center justify-center py-12">
      <div class="text-center space-y-2">
        <div class="inline-flex items-center gap-2">
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse animation-delay-200"></div>
          <div class="w-2 h-2 bg-primary rounded-full animate-pulse animation-delay-400"></div>
        </div>
        <p class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {{ t("app.settings.loadingSettings") }}
        </p>
      </div>
    </div>
  </section>
</template>
<style scoped>
@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
.animation-delay-200 {
  animation-delay: 200ms;
}
.animation-delay-400 {
  animation-delay: 400ms;
}
</style>
