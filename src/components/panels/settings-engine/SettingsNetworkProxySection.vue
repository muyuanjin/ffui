<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

type NetworkProxyMode = "none" | "system" | "custom";
const networkProxyMode = computed<NetworkProxyMode>({
  get() {
    const raw = (props.appSettings as any)?.networkProxy?.mode;
    if (raw === "none" || raw === "custom") return raw;
    return "system";
  },
  set(mode) {
    if (mode === "system") {
      emit("update:appSettings", { ...props.appSettings, networkProxy: undefined });
      return;
    }
    const current = (props.appSettings as any).networkProxy ?? {};
    emit("update:appSettings", {
      ...props.appSettings,
      networkProxy: { ...current, mode },
    });
  },
});

const networkProxyUrlDraft = ref<string | null>(null);
const getNetworkProxyUrlInputValue = () => {
  const raw = (props.appSettings as any)?.networkProxy?.proxyUrl;
  return typeof raw === "string" ? raw : "";
};

const setNetworkProxyUrlDraft = (value: string) => {
  networkProxyUrlDraft.value = value;
};

const commitNetworkProxyUrlDraft = () => {
  const draft = networkProxyUrlDraft.value;
  networkProxyUrlDraft.value = null;
  if (draft === null) return;
  if (networkProxyMode.value !== "custom") return;
  const trimmed = draft.trim();
  const nextUrl = trimmed.length > 0 ? trimmed : undefined;
  const current = (props.appSettings as any).networkProxy ?? { mode: "custom" };
  emit("update:appSettings", {
    ...props.appSettings,
    networkProxy: { ...current, mode: "custom", proxyUrl: nextUrl },
  });
};
</script>

<template>
  <div class="py-1" data-testid="settings-network-proxy">
    <div class="flex items-center justify-between gap-2">
      <label class="text-[11px] font-medium text-foreground">
        {{ t("app.settings.networkProxyTitle") }}
      </label>
      <div class="flex items-center justify-end gap-2">
        <label class="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="settings-network-proxy-mode"
            class="w-3 h-3 rounded border-border/50"
            :checked="networkProxyMode === 'none'"
            @change="networkProxyMode = 'none'"
          />
          <span class="text-[10px] text-muted-foreground select-none">
            {{ t("app.settings.networkProxyModeNone") }}
          </span>
        </label>
        <label class="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="settings-network-proxy-mode"
            class="w-3 h-3 rounded border-border/50"
            :checked="networkProxyMode === 'system'"
            @change="networkProxyMode = 'system'"
          />
          <span class="text-[10px] text-muted-foreground select-none">
            {{ t("app.settings.networkProxyModeSystem") }}
          </span>
        </label>
        <label class="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="settings-network-proxy-mode"
            class="w-3 h-3 rounded border-border/50"
            :checked="networkProxyMode === 'custom'"
            @change="networkProxyMode = 'custom'"
          />
          <span class="text-[10px] text-muted-foreground select-none">
            {{ t("app.settings.networkProxyModeCustom") }}
          </span>
        </label>
      </div>
    </div>

    <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
      {{ t("app.settings.networkProxyDescription") }}
    </p>

    <div v-if="networkProxyMode === 'custom'" class="mt-1 flex items-center gap-2">
      <span class="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">
        {{ t("app.settings.networkProxyUrlLabel") }}:
      </span>
      <input
        type="text"
        class="h-6 text-[10px] font-mono bg-background/50 border border-border/30 px-2 flex-1 rounded-md"
        :value="networkProxyUrlDraft ?? getNetworkProxyUrlInputValue()"
        :placeholder="t('app.settings.networkProxyUrlPlaceholder')"
        @input="(e) => setNetworkProxyUrlDraft((e.target as HTMLInputElement).value)"
        @blur="commitNetworkProxyUrlDraft"
        @keydown.enter.prevent="commitNetworkProxyUrlDraft"
      />
    </div>

    <p v-if="networkProxyMode === 'custom'" class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
      {{ t("app.settings.networkProxyUrlHint") }}
    </p>
  </div>
</template>

