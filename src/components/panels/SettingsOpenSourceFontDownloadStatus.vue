<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { listen } from "@tauri-apps/api/event";
import {
  cancelOpenSourceFontDownload,
  fetchOpenSourceFontDownloadSnapshot,
  hasTauri,
  startOpenSourceFontDownload,
  type UiFontDownloadSnapshot,
} from "@/lib/backend";

const props = defineProps<{
  fontId: string | null;
}>();

const { t, locale } = useI18n();

const download = ref<UiFontDownloadSnapshot | null>(null);
const cancelling = ref(false);
let sessionId = 0;
let unlisten: null | (() => void) = null;

const formatBytes = (value?: number | null): string => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const percent = computed(() => {
  const snapshot = download.value;
  const total = snapshot?.totalBytes ?? null;
  const received = snapshot?.receivedBytes ?? 0;
  if (!snapshot) return 0;
  if (!total || total <= 0) {
    return snapshot.status === "downloading" ? 10 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
});

const variant = computed(() => {
  const status = download.value?.status ?? null;
  if (cancelling.value) return "warning";
  if (status === "ready") return "success";
  if (status === "error") return "error";
  if (status === "canceled") return "muted";
  return "default";
});

const statusText = computed(() => {
  const snapshot = download.value;
  if (!snapshot) return t("app.settings.uiOpenSourceDownloadIdle");
  if (cancelling.value) return t("app.settings.uiOpenSourceDownloadCanceling");
  if (snapshot.status === "starting") return t("app.settings.uiOpenSourceDownloadStarting");
  if (snapshot.status === "downloading") {
    const total = snapshot.totalBytes;
    if (total) {
      return `${t("app.settings.uiOpenSourceDownloadDownloading")} ${formatBytes(snapshot.receivedBytes)} / ${formatBytes(total)} (${percent.value}%)`;
    }
    return `${t("app.settings.uiOpenSourceDownloadDownloading")} ${formatBytes(snapshot.receivedBytes)}`;
  }
  if (snapshot.status === "ready") return t("app.settings.uiOpenSourceDownloadReady");
  if (snapshot.status === "canceled") return t("app.settings.uiOpenSourceDownloadCanceled");
  if (snapshot.status === "error") {
    return `${t("app.settings.uiOpenSourceDownloadError")} ${snapshot.error ?? ""}`.trim();
  }
  return t("app.settings.uiOpenSourceDownloadIdle");
});

const refreshOrStart = async () => {
  const id = props.fontId?.trim() ?? "";
  download.value = null;
  cancelling.value = false;
  sessionId = 0;
  if (!id || !hasTauri()) return;

  const snapshot =
    typeof fetchOpenSourceFontDownloadSnapshot === "function"
      ? await fetchOpenSourceFontDownloadSnapshot(id)
      : null;

  if (snapshot) {
    download.value = snapshot;
    sessionId = snapshot.sessionId;
    if (snapshot.status === "starting" || snapshot.status === "downloading") {
      return;
    }
  }

  if (typeof startOpenSourceFontDownload === "function") {
    const started = await startOpenSourceFontDownload(id);
    download.value = started;
    sessionId = started.sessionId;
  }
};

const start = async () => {
  const id = props.fontId?.trim() ?? "";
  if (!id || !hasTauri()) return;
  cancelling.value = false;
  if (typeof startOpenSourceFontDownload !== "function") return;
  const snapshot = await startOpenSourceFontDownload(id);
  download.value = snapshot;
  sessionId = snapshot.sessionId;
};

const cancel = async () => {
  const id = props.fontId?.trim() ?? "";
  if (!id || !hasTauri()) return;
  cancelling.value = true;
  await cancelOpenSourceFontDownload?.(id);
};

onMounted(async () => {
  if (!hasTauri()) return;
  unlisten = await listen<UiFontDownloadSnapshot>("ui_font_download", (event) => {
    const payload = event.payload;
    const currentId = props.fontId?.trim() ?? "";
    if (!currentId || payload.fontId !== currentId) return;
    if (sessionId && payload.sessionId !== sessionId) return;
    download.value = payload;
    if (payload.status === "canceled" || payload.status === "ready" || payload.status === "error") {
      cancelling.value = false;
    }
  });
});

onUnmounted(() => {
  unlisten?.();
  unlisten = null;
});

watch(
  () => props.fontId,
  () => {
    void refreshOrStart();
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="hasTauri() && fontId" class="rounded border border-border/40 bg-background/40 p-2" :data-locale="locale">
    <div class="flex items-center justify-between gap-2">
      <p class="text-[9px] text-muted-foreground leading-snug">
        {{ statusText }}
      </p>
      <div class="flex items-center gap-1">
        <Button
          v-if="download?.status !== 'downloading' && !cancelling"
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px]"
          @click="start"
        >
          {{ download?.status === 'error' ? t("app.settings.uiOpenSourceDownloadRetry") : t("app.settings.uiOpenSourceDownloadStart") }}
        </Button>
        <Button
          v-else
          variant="outline"
          size="sm"
          class="h-6 px-2 text-[10px]"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ t("app.settings.uiOpenSourceDownloadCancel") }}
        </Button>
      </div>
    </div>

    <Progress
      class="mt-1 h-1.5"
      :model-value="percent"
      :variant="variant"
    />
  </div>
</template>
