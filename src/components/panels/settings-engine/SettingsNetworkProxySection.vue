<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AppSettings, NetworkProxyMode, NetworkProxySettings } from "@/types";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

const props = defineProps<{
  appSettings: AppSettings;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

const getCurrentNetworkProxy = (): NetworkProxySettings => {
  return props.appSettings.networkProxy ?? { mode: "system", fallbackToDirectOnError: true };
};

const networkProxyMode = computed<NetworkProxyMode>({
  get() {
    const raw = props.appSettings.networkProxy?.mode;
    if (raw === "none" || raw === "custom") return raw;
    return "system";
  },
  set(mode) {
    const current = getCurrentNetworkProxy();
    if (mode === "system") {
      const next: NetworkProxySettings = { ...current, mode: "system", proxyUrl: undefined };
      emit("update:appSettings", { ...props.appSettings, networkProxy: next });
      return;
    }
    const base: NetworkProxySettings = mode === "none" ? { mode: "none" } : { ...current };
    emit("update:appSettings", {
      ...props.appSettings,
      networkProxy: { ...base, mode },
    });
  },
});

const updateNetworkProxyMode = (value: unknown) => {
  if (value === "none" || value === "system" || value === "custom") {
    networkProxyMode.value = value;
  }
};

const networkProxyUrlDraft = ref<string | null>(null);
const getNetworkProxyUrlInputValue = () => {
  return props.appSettings.networkProxy?.proxyUrl ?? "";
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
  const current = getCurrentNetworkProxy();
  emit("update:appSettings", {
    ...props.appSettings,
    networkProxy: { ...current, mode: "custom", proxyUrl: nextUrl },
  });
};

const fallbackToDirectOnError = computed<boolean>({
  get() {
    return props.appSettings.networkProxy?.fallbackToDirectOnError ?? true;
  },
  set(value) {
    if (networkProxyMode.value === "none") return;
    const current = getCurrentNetworkProxy();
    emit("update:appSettings", {
      ...props.appSettings,
      networkProxy: { ...current, fallbackToDirectOnError: !!value },
    });
  },
});

const proxyUrlError = computed<string | null>(() => {
  if (networkProxyMode.value !== "custom") return null;
  const text = (props.appSettings.networkProxy?.proxyUrl ?? "").trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "socks5:" && u.protocol !== "socks5h:") {
      return t("app.settings.networkProxyUrlInvalid");
    }
    return null;
  } catch {
    return t("app.settings.networkProxyUrlInvalid");
  }
});
</script>

<template>
  <div class="py-1" data-testid="settings-network-proxy">
    <div class="flex items-center justify-between gap-2">
      <label class="text-[11px] font-medium text-foreground">
        {{ t("app.settings.networkProxyModeLabel") }}
      </label>
      <RadioGroup
        class="flex items-center justify-end gap-2"
        :model-value="networkProxyMode"
        @update:model-value="updateNetworkProxyMode"
      >
        <label class="flex items-center gap-1 cursor-pointer">
          <RadioGroupItem
            id="settings-network-proxy-mode-none"
            data-testid="settings-network-proxy-mode-none"
            value="none"
            class="h-3 w-3 border-border/50"
          />
          <span class="text-[10px] text-muted-foreground select-none">
            {{ t("app.settings.networkProxyModeNone") }}
          </span>
        </label>
        <label class="flex items-center gap-1 cursor-pointer">
          <RadioGroupItem
            id="settings-network-proxy-mode-system"
            data-testid="settings-network-proxy-mode-system"
            value="system"
            class="h-3 w-3 border-border/50"
          />
          <span class="text-[10px] text-muted-foreground select-none">
            {{ t("app.settings.networkProxyModeSystem") }}
          </span>
        </label>
        <label class="flex items-center gap-1 cursor-pointer">
          <RadioGroupItem
            id="settings-network-proxy-mode-custom"
            data-testid="settings-network-proxy-mode-custom"
            value="custom"
            class="h-3 w-3 border-border/50"
          />
          <span class="text-[10px] text-muted-foreground select-none">
            {{ t("app.settings.networkProxyModeCustom") }}
          </span>
        </label>
      </RadioGroup>
    </div>

    <p class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
      {{ t("app.settings.networkProxyDescription") }}
    </p>

    <div v-if="networkProxyMode !== 'none'" class="mt-1 flex items-center justify-between gap-2">
      <span class="text-[10px] text-foreground">
        {{ t("app.settings.networkProxyFallbackLabel") }}
      </span>
      <Switch
        data-testid="settings-network-proxy-fallback-direct"
        :model-value="fallbackToDirectOnError"
        @update:model-value="(v) => (fallbackToDirectOnError = !!v)"
      />
    </div>
    <p v-if="networkProxyMode !== 'none'" class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
      {{ t("app.settings.networkProxyFallbackHint") }}
    </p>

    <div v-if="networkProxyMode === 'custom'" class="mt-1 flex items-center gap-2">
      <span class="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">
        {{ t("app.settings.networkProxyUrlLabel") }}:
      </span>
      <Input
        class="h-6 text-[10px] font-mono bg-background/50 border-border/30 px-2 flex-1 rounded-md"
        :model-value="networkProxyUrlDraft ?? getNetworkProxyUrlInputValue()"
        :placeholder="t('app.settings.networkProxyUrlPlaceholder')"
        @update:model-value="(v) => setNetworkProxyUrlDraft(String(v ?? ''))"
        @blur="commitNetworkProxyUrlDraft"
        @keydown.enter.prevent="commitNetworkProxyUrlDraft"
      />
    </div>

    <p v-if="proxyUrlError" class="mt-0.5 text-[9px] text-red-600 dark:text-red-400 leading-snug">
      {{ proxyUrlError }}
    </p>

    <p v-if="networkProxyMode === 'custom'" class="mt-0.5 text-[9px] text-muted-foreground leading-snug">
      {{ t("app.settings.networkProxyUrlHint") }}
    </p>
  </div>
</template>
