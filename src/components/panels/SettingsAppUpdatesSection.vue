<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { extractReleaseHighlights } from "@/lib/releaseNotes";
import type { AppLocale } from "@/i18n";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n";
import type { AppSettings } from "@/types";

export interface AppUpdateUiState {
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

const { t, locale } = useI18n();

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

const normalizedLocale = computed<AppLocale>(() => {
  return isAppLocale(locale.value) ? (locale.value as AppLocale) : DEFAULT_LOCALE;
});

const currentVersionLabel = computed(() => {
  const raw = props.appUpdate.currentVersion;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("v") ? trimmed : `v${trimmed}`;
});

const availableHighlights = computed(() => {
  if (!props.appUpdate.available) return [];
  const body = props.appUpdate.availableBody;
  if (typeof body !== "string" || body.trim().length === 0) return [];
  return extractReleaseHighlights(body, normalizedLocale.value).slice(0, 5);
});
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm flex flex-col" data-testid="settings-card-app-update">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.appUpdateTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent class="p-2 flex flex-col flex-1">
      <div class="flex flex-col flex-1 justify-between gap-2">
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
          <span class="text-[9px] text-muted-foreground" data-testid="settings-current-version">
            {{ t("app.settings.currentVersionLabel") }}
            <span class="font-mono text-foreground/80">
              {{ currentVersionLabel ?? t("app.settings.unknownValue") }}
            </span>
          </span>
        </div>

        <div class="flex items-center justify-between gap-2">
          <label class="flex items-center gap-2">
            <Checkbox
              v-model:checked="autoCheckModel"
              class="h-3 w-3 border-border/50"
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
            <span v-if="appUpdate.available && availableHighlights.length > 0" class="block mt-1 text-muted-foreground">
              <span class="text-[9px] font-semibold tracking-wide uppercase text-muted-foreground/90">
                {{ t("app.settings.updateHighlightsTitle") }}
              </span>
              <span
                v-for="(item, idx) in availableHighlights"
                :key="idx"
                class="block text-[9px] text-foreground/80"
                data-testid="settings-update-highlight-item"
              >
                • {{ item }}
              </span>
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
      </div>
    </CardContent>
  </Card>
</template>
