<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import type { AppSettings } from "@/types";

export interface AppUpdateUiState {
  configured?: boolean | null;
  autoCheckDefault?: boolean;
  available: boolean;
  checking: boolean;
  installing: boolean;
  availableVersion: string | null;
  currentVersion: string | null;
  lastCheckedAtMs: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
}

const props = withDefaults(
  defineProps<{
    appSettings: AppSettings | null;
    appUpdate: AppUpdateUiState;
    checkForAppUpdate?: (options?: { force?: boolean }) => Promise<void>;
    installAppUpdate?: () => Promise<void>;
  }>(),
  {},
);

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const autoCheckModel = computed<boolean>({
  get() {
    const raw = (props.appSettings as any)?.updater?.autoCheck;
    if (typeof raw === "boolean") return raw;
    return props.appUpdate.autoCheckDefault ?? true;
  },
  set(value) {
    if (!props.appSettings) return;
    const current = props.appSettings as any;
    const updater = { ...(current.updater ?? {}) };
    updater.autoCheck = value === true;
    emit("update:appSettings", { ...current, updater });
  },
});

const formatBytesMb = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  return (bytes / 1024 / 1024).toFixed(1);
};

const progressLabel = computed(() => {
  const downloaded = Number(props.appUpdate.downloadedBytes ?? 0);
  const total = props.appUpdate.totalBytes == null ? null : Number(props.appUpdate.totalBytes);
  if (!Number.isFinite(downloaded) || downloaded <= 0) return null;
  if (total != null && Number.isFinite(total) && total > 0) {
    return `${formatBytesMb(downloaded)} / ${formatBytesMb(total)} MB`;
  }
  return `${formatBytesMb(downloaded)} MB`;
});

const statusLabel = computed(() => {
  if (!hasTauri()) return t("app.settings.appUpdateUnavailableHint");
  if (props.appUpdate.configured === false) return t("app.settings.appUpdateNotConfiguredHint");
  if (props.appUpdate.installing) return t("app.settings.appUpdateInstallingHint");
  if (props.appUpdate.checking) return t("app.settings.appUpdateCheckingHint");
  if (props.appUpdate.error) return t("app.settings.appUpdateErrorHint", { error: props.appUpdate.error });
  if (props.appUpdate.available) {
    return t("app.settings.appUpdateAvailableHint", {
      version: props.appUpdate.availableVersion ?? "?",
      current: props.appUpdate.currentVersion ?? "?",
    });
  }
  return t("app.settings.appUpToDateHint");
});
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.appUpdateTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent class="p-2 space-y-2">
      <div class="flex items-start justify-between gap-2">
        <p class="text-[10px] text-muted-foreground leading-snug">
          {{ t("app.settings.appUpdateDescription") }}
        </p>
        <Button
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px] shrink-0"
          data-testid="settings-check-updates"
          :disabled="!hasTauri() || appUpdate.configured === false || appUpdate.checking || appUpdate.installing"
          @click="checkForAppUpdate?.({ force: true })"
        >
          {{ t("app.settings.checkForUpdatesButton") }}
        </Button>
      </div>

      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-2">
          <input
            v-model="autoCheckModel"
            type="checkbox"
            class="w-3 h-3 rounded border-border/50"
            data-testid="settings-auto-check-updates"
            :disabled="!hasTauri() || appUpdate.configured === false"
          />
          <span class="text-[10px] text-foreground">
            {{ t("app.settings.autoCheckUpdatesLabel") }}
          </span>
        </label>

        <span v-if="appUpdate.lastCheckedAtMs" class="text-[9px] text-muted-foreground">
          {{ t("app.settings.lastCheckedAtLabel") }}
          {{ new Date(appUpdate.lastCheckedAtMs).toLocaleString() }}
        </span>
      </div>

      <div class="flex items-start justify-between gap-2">
        <p
          class="text-[10px] leading-snug"
          :class="appUpdate.error ? 'text-red-500' : appUpdate.available ? 'text-sky-400' : 'text-muted-foreground'"
          data-testid="settings-update-status"
        >
          {{ statusLabel }}
          <span v-if="progressLabel" class="block text-[9px] text-muted-foreground mt-0.5">
            {{ t("app.settings.downloadProgressLabel") }} {{ progressLabel }}
          </span>
        </p>
        <Button
          v-if="appUpdate.available"
          variant="default"
          size="sm"
          class="h-6 px-2 text-[10px] shrink-0"
          data-testid="settings-install-update"
          :disabled="!hasTauri() || appUpdate.configured === false || appUpdate.checking || appUpdate.installing"
          @click="installAppUpdate?.()"
        >
          {{ t("app.settings.installUpdateButton") }}
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
