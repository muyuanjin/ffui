<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppSettings, ConfigBundleImportResult, DataRootInfo, DataRootMode } from "@/types";
import {
  acknowledgeDataRootFallbackNotice,
  clearAllAppData,
  exportConfigBundle,
  fetchDataRootInfo,
  hasTauri,
  importConfigBundle,
  openDataRootDir,
  setDataRootMode,
} from "@/lib/backend";

type StatusTone = "neutral" | "success" | "error";
type ActionStatus = { tone: StatusTone; message: string };

const props = defineProps<{
  reloadPresets?: () => Promise<void>;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const dataRootInfo = ref<DataRootInfo | null>(null);
const dataRootError = ref<string | null>(null);
const activeAction = ref<string | null>(null);
const actionStatus = ref<ActionStatus | null>(null);
let statusTimer: number | null = null;

const setStatus = (tone: StatusTone, message: string) => {
  actionStatus.value = { tone, message };
  if (statusTimer != null) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusTimer = window.setTimeout(() => {
    actionStatus.value = null;
    statusTimer = null;
  }, 3000);
};

const statusClass = computed(() => {
  if (!actionStatus.value) return "text-muted-foreground";
  if (actionStatus.value.tone === "success") return "text-emerald-500";
  if (actionStatus.value.tone === "error") return "text-destructive";
  return "text-muted-foreground";
});

const refreshDataRootInfo = async () => {
  if (!hasTauri()) return;
  dataRootError.value = null;
  try {
    dataRootInfo.value = await fetchDataRootInfo();
  } catch (error) {
    dataRootError.value = String((error as Error)?.message ?? error);
  }
};

onMounted(() => {
  void refreshDataRootInfo();
});

const desiredModeModel = computed<DataRootMode>({
  get() {
    return dataRootInfo.value?.desiredMode ?? "system";
  },
  async set(nextMode) {
    if (!dataRootInfo.value) return;
    if (!hasTauri()) {
      setStatus("neutral", t("app.settings.dataRootDesktopOnly") as string);
      return;
    }
    if (activeAction.value) return;
    activeAction.value = "mode";
    try {
      dataRootInfo.value = await setDataRootMode(nextMode);
      if (dataRootInfo.value.switchPending) {
        setStatus("neutral", t("app.settings.dataRootSwitchPending") as string);
      }
    } catch (error) {
      setStatus("error", String((error as Error)?.message ?? error));
    } finally {
      activeAction.value = null;
    }
  },
});

const effectiveModeLabel = computed(() => {
  const mode = dataRootInfo.value?.effectiveMode ?? "system";
  return t(`app.settings.dataRootModes.${mode}`);
});

const dataRootPath = computed(() => dataRootInfo.value?.dataRoot ?? "");

const dismissFallbackNotice = async () => {
  if (!dataRootInfo.value?.fallbackNoticePending) return;
  try {
    await acknowledgeDataRootFallbackNotice();
    dataRootInfo.value = {
      ...dataRootInfo.value,
      fallbackNoticePending: false,
    };
  } catch (error) {
    setStatus("error", String((error as Error)?.message ?? error));
  }
};

const handleOpenDir = async () => {
  if (!hasTauri()) {
    setStatus("neutral", t("app.settings.dataRootDesktopOnly") as string);
    return;
  }
  if (activeAction.value) return;
  activeAction.value = "open";
  try {
    await openDataRootDir();
    setStatus("success", t("app.settings.dataRootOpenSuccess") as string);
  } catch (error) {
    setStatus("error", String((error as Error)?.message ?? error));
  } finally {
    activeAction.value = null;
  }
};

const handleExportConfig = async () => {
  if (!hasTauri()) {
    setStatus("neutral", t("app.settings.dataRootDesktopOnly") as string);
    return;
  }
  if (activeAction.value) return;
  activeAction.value = "export";
  try {
    const selection = await saveDialog({
      defaultPath: "ffui-config.json",
      filters: [{ name: "FFUI Config", extensions: ["json"] }],
    });
    const path = typeof selection === "string" ? selection : "";
    if (!path) {
      activeAction.value = null;
      return;
    }
    await exportConfigBundle(path);
    setStatus("success", t("app.settings.dataRootExportSuccess") as string);
  } catch (error) {
    setStatus("error", String((error as Error)?.message ?? error));
  } finally {
    activeAction.value = null;
  }
};

const handleImportConfig = async () => {
  if (!hasTauri()) {
    setStatus("neutral", t("app.settings.dataRootDesktopOnly") as string);
    return;
  }
  if (activeAction.value) return;
  activeAction.value = "import";
  try {
    const selection = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "FFUI Config", extensions: ["json"] }],
    });
    const path = typeof selection === "string" ? selection : "";
    if (!path) {
      activeAction.value = null;
      return;
    }
    const result: ConfigBundleImportResult = await importConfigBundle(path);
    emit("update:appSettings", result.settings);
    await props.reloadPresets?.();
    await refreshDataRootInfo();
    setStatus("success", t("app.settings.dataRootImportSuccess") as string);
  } catch (error) {
    setStatus("error", String((error as Error)?.message ?? error));
  } finally {
    activeAction.value = null;
  }
};

const handleClearAll = async () => {
  if (!hasTauri()) {
    setStatus("neutral", t("app.settings.dataRootDesktopOnly") as string);
    return;
  }
  if (activeAction.value) return;
  const confirmed = window.confirm(t("app.settings.dataRootClearConfirm") as string);
  if (!confirmed) return;
  activeAction.value = "clear";
  try {
    const settings = await clearAllAppData();
    emit("update:appSettings", settings);
    await props.reloadPresets?.();
    await refreshDataRootInfo();
    setStatus("success", t("app.settings.dataRootClearSuccess") as string);
  } catch (error) {
    setStatus("error", String((error as Error)?.message ?? error));
  } finally {
    activeAction.value = null;
  }
};
</script>

<template>
  <Card class="border-border/50 bg-card/95 shadow-sm" data-testid="settings-data-storage">
    <CardHeader class="py-2 px-3 border-b border-border/30">
      <CardTitle class="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
        {{ t("app.settings.dataRootSectionTitle") }}
      </CardTitle>
    </CardHeader>
    <CardContent class="p-2 space-y-2">
      <p class="text-[10px] text-muted-foreground leading-snug">
        {{ t("app.settings.dataRootSectionDescription") }}
      </p>

      <Alert
        v-if="dataRootInfo?.fallbackNoticePending"
        class="border-amber-500/40 bg-amber-500/10"
        data-testid="settings-data-root-fallback-notice"
      >
        <AlertTitle class="text-[11px]">{{ t("app.settings.dataRootFallbackTitle") }}</AlertTitle>
        <AlertDescription class="text-[10px] leading-snug">
          {{ t("app.settings.dataRootFallbackNotice") }}
        </AlertDescription>
        <Button
          variant="outline"
          size="sm"
          class="mt-2 h-6 px-2 text-[10px]"
          data-testid="settings-data-root-fallback-dismiss"
          @click="dismissFallbackNotice"
        >
          {{ t("app.settings.dataRootFallbackDismiss") }}
        </Button>
      </Alert>

      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-[11px] font-medium text-foreground">
            {{ t("app.settings.dataRootModeLabel") }}
          </p>
          <p class="text-[9px] text-muted-foreground">
            {{ t("app.settings.dataRootModeHint") }}
          </p>
        </div>
        <Select v-model="desiredModeModel" :disabled="!dataRootInfo || activeAction === 'mode'">
          <SelectTrigger
            class="h-7 text-[10px] bg-background/50 border-border/30"
            data-testid="settings-data-root-mode-trigger"
          >
            <SelectValue>{{ t(`app.settings.dataRootModes.${desiredModeModel}`) }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system" class="text-[10px]" data-testid="settings-data-root-mode-system">
              {{ t("app.settings.dataRootModes.system") }}
            </SelectItem>
            <SelectItem value="portable" class="text-[10px]" data-testid="settings-data-root-mode-portable">
              {{ t("app.settings.dataRootModes.portable") }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1">
        <p class="text-[9px] text-muted-foreground">
          {{ t("app.settings.dataRootEffectiveLabel") }}
          <span class="font-medium text-foreground">{{ effectiveModeLabel }}</span>
        </p>
        <p v-if="dataRootInfo?.switchPending" class="text-[9px] text-amber-600">
          {{ t("app.settings.dataRootSwitchPending") }}
        </p>
        <p class="text-[9px] text-muted-foreground break-all">
          {{ t("app.settings.dataRootPathLabel") }}
          <span class="font-mono text-foreground">{{ dataRootPath || t("app.settings.unknownValue") }}</span>
        </p>
        <p v-if="dataRootError" class="text-[9px] text-destructive">
          {{ dataRootError }}
        </p>
      </div>

      <div class="grid gap-1">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">{{ t("app.settings.dataRootOpenLabel") }}</span>
          <Button
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            data-testid="settings-data-root-open"
            :disabled="activeAction === 'open'"
            @click="handleOpenDir"
          >
            {{ t("app.settings.dataRootOpenButton") }}
          </Button>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">{{ t("app.settings.dataRootExportLabel") }}</span>
          <Button
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            data-testid="settings-data-root-export"
            :disabled="activeAction === 'export'"
            @click="handleExportConfig"
          >
            {{ t("app.settings.dataRootExportButton") }}
          </Button>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">{{ t("app.settings.dataRootImportLabel") }}</span>
          <Button
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px]"
            data-testid="settings-data-root-import"
            :disabled="activeAction === 'import'"
            @click="handleImportConfig"
          >
            {{ t("app.settings.dataRootImportButton") }}
          </Button>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">{{ t("app.settings.dataRootClearLabel") }}</span>
          <Button
            variant="outline"
            size="sm"
            class="h-6 px-2 text-[10px] border-destructive/60 text-destructive hover:bg-destructive/10"
            data-testid="settings-data-root-clear"
            :disabled="activeAction === 'clear'"
            @click="handleClearAll"
          >
            {{ t("app.settings.dataRootClearButton") }}
          </Button>
        </div>
      </div>

      <p class="min-h-[14px] text-[9px]" :class="statusClass" data-testid="settings-data-root-status">
        {{ actionStatus?.message ?? t("app.settings.dataRootStatusIdle") }}
      </p>

      <p class="text-[9px] text-muted-foreground leading-snug">
        {{ t("app.settings.dataRootDesktopHint") }}
      </p>
    </CardContent>
  </Card>
</template>
