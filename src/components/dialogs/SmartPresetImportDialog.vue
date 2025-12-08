<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FFmpegPreset } from "@/types";
import { loadSmartDefaultPresets } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "confirmed", presets: FFmpegPreset[]): void;
  (e: "openToolsSettings"): void;
}>();

const { t } = useI18n();

const loading = ref(false);
const error = ref<string | null>(null);
const presets = ref<FFmpegPreset[]>([]);
const selectedIds = ref<Set<string>>(new Set());

type CodecPreference = "auto" | "h264" | "hevc" | "av1";
type UseCasePreference = "share" | "daily" | "archive";

const codecPreference = ref<CodecPreference>("auto");
const useCasePreference = ref<UseCasePreference>("daily");

const classifyCodec = (encoder: string): CodecPreference | "other" => {
  const lower = encoder.toLowerCase();
  if (lower.includes("x264")) return "h264";
  if (lower.includes("hevc") || lower.includes("h265")) return "hevc";
  if (lower.includes("av1")) return "av1";
  return "other";
};

const classifyUseCase = (preset: FFmpegPreset): UseCasePreference => {
  const text = `${preset.id} ${preset.name} ${preset.description ?? ""}`.toLowerCase();
  if (text.includes("archive") || text.includes("归档") || text.includes("visually")) {
    return "archive";
  }
  if (text.includes("fast") || text.includes("share") || text.includes("分享")) {
    return "share";
  }
  return "daily";
};

const sortPresetsByPreference = () => {
  const prefs = {
    codec: codecPreference.value,
    useCase: useCasePreference.value,
  };
  presets.value = [...presets.value].sort((a, b) => {
    const codecA = classifyCodec(a.video.encoder as any);
    const codecB = classifyCodec(b.video.encoder as any);
    const useA = classifyUseCase(a);
    const useB = classifyUseCase(b);

    const codecScore = (codec: CodecPreference | "other"): number => {
      if (prefs.codec === "auto") return codec === "other" ? 0 : 1;
      return codec === prefs.codec ? 2 : 0;
    };

    const useScore = (use: UseCasePreference): number => {
      if (!prefs.useCase) return 1;
      return use === prefs.useCase ? 2 : 1;
    };

    const scoreA = codecScore(codecA) + useScore(useA);
    const scoreB = codecScore(codecB) + useScore(useB);

    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.name.localeCompare(b.name);
  });
};

const updateSelectionByPreference = () => {
  const prefs = {
    codec: codecPreference.value,
    useCase: useCasePreference.value,
  };
  const list = presets.value;
  if (!Array.isArray(list) || list.length === 0) {
    selectedIds.value = new Set();
    return;
  }

  const filtered = list.filter((preset) => {
    const codec = classifyCodec(preset.video.encoder as any);
    const use = classifyUseCase(preset);

    if (prefs.codec !== "auto" && codec !== prefs.codec) {
      return false;
    }

    if (prefs.useCase === "share") {
      return use === "share";
    }
    if (prefs.useCase === "archive") {
      return use === "archive";
    }
    // "daily" 默认不过滤用途，保留“快速 + 归档”两类，让用户手动调优。
    return true;
  });

  const finalList = filtered.length > 0 ? filtered : list;
  selectedIds.value = new Set(finalList.map((p) => p.id));
};

const fetchSmartPresets = async () => {
  if (!props.open) return;
  loading.value = true;
  error.value = null;
  presets.value = [];
  selectedIds.value = new Set();
  try {
    const list = await loadSmartDefaultPresets();
    const safeList = Array.isArray(list) ? list : [];
    presets.value = safeList;
    sortPresetsByPreference();
    updateSelectionByPreference();
  } catch (err: any) {
    console.error("failed to load smart default presets", err);
    error.value = String(err?.message ?? err ?? "Unknown error");
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (props.open) {
    void fetchSmartPresets();
  }
});

const toggleSelection = (id: string) => {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
};

const handleConfirm = () => {
  const chosen = presets.value.filter((p) => selectedIds.value.has(p.id));
  emit("confirmed", chosen);
  emit("update:open", false);
};

const handleOpenToolsSettings = () => {
  emit("openToolsSettings");
  emit("update:open", false);
};

const handleCancel = () => {
  emit("update:open", false);
};

const nvencAvailable = computed(() =>
  presets.value.some(
    (p) =>
      typeof (p as any).video?.encoder === "string" &&
      ((p as any).video.encoder as string).toLowerCase().includes("hevc"),
  ),
);

const av1Available = computed(() =>
  presets.value.some(
    (p) =>
      typeof (p as any).video?.encoder === "string" &&
      ((p as any).video.encoder as string).toLowerCase().includes("av1"),
  ),
);
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
  >
    <div
      class="bg-background w-full max-w-3xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]"
    >
      <div class="flex items-center justify-between px-5 py-3 border-b border-border">
        <div class="flex flex-col">
          <h2 class="text-base font-semibold">
            {{ t("presets.importSmartPack") }}
          </h2>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ t("presets.importSmartPackDescription") }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:text-foreground"
          @click="handleCancel"
        >
          ✕
        </Button>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div class="text-[11px] text-muted-foreground mb-2">
          <span v-if="nvencAvailable">
            {{ t("presets.hardwareSummaryNvenc") }}
          </span>
          <span v-else>
            {{ t("presets.hardwareSummaryCpuOnly") }}
          </span>
          <span v-if="av1Available">
            · {{ t("presets.hardwareSummaryAv1") }}
          </span>
        </div>
        <div class="flex flex-col md:flex-row gap-3 text-[11px] text-muted-foreground mb-2">
          <div class="flex-1">
            <div class="mb-1 font-medium">
              {{ t("presets.codecPreferenceLabel") }}
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Button
                v-for="code in [
                  { value: 'auto', label: t('presets.codecPreferenceAuto') },
                  { value: 'h264', label: t('presets.codecPreferenceH264') },
                  { value: 'hevc', label: t('presets.codecPreferenceHevc') },
                  { value: 'av1', label: t('presets.codecPreferenceAv1') },
                ]"
                :key="code.value as string"
                :variant="codecPreference === code.value ? 'default' : 'outline'"
                size="sm"
                class="h-6 px-2 text-[10px]"
                @click="
                    () => {
                      // 模板上下文已自动解包 ref，这里直接赋值以便触发响应式更新
                      codecPreference = code.value as CodecPreference;
                      sortPresetsByPreference();
                      updateSelectionByPreference();
                    }
                "
              >
                {{ code.label }}
              </Button>
            </div>
          </div>
          <div class="flex-1">
            <div class="mb-1 font-medium">
              {{ t("presets.useCasePreferenceLabel") }}
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Button
                v-for="use in [
                  { value: 'share', label: t('presets.useCasePreferenceShare') },
                  { value: 'daily', label: t('presets.useCasePreferenceDaily') },
                  { value: 'archive', label: t('presets.useCasePreferenceArchive') },
                ]"
                :key="use.value as string"
                :variant="useCasePreference === use.value ? 'default' : 'outline'"
                size="sm"
                class="h-6 px-2 text-[10px]"
                @click="
                    () => {
                      useCasePreference = use.value as UseCasePreference;
                      sortPresetsByPreference();
                      updateSelectionByPreference();
                    }
                "
              >
                {{ use.label }}
              </Button>
            </div>
          </div>
        </div>
        <div v-if="loading" class="text-xs text-muted-foreground">
          {{ t("common.loading") || "Loading smart presets…" }}
        </div>
        <div v-else-if="error" class="text-xs text-destructive">
          {{ error }}
        </div>
        <div v-else-if="presets.length === 0" class="text-xs text-muted-foreground">
          {{ t("presets.presetCount", { count: 0 }) }}
        </div>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card
            v-for="preset in presets"
            :key="preset.id"
            :class="[
              'border transition-colors cursor-pointer',
              selectedIds.has(preset.id)
                ? 'border-primary bg-primary/5'
                : 'border-border/60 bg-card/80 hover:border-primary/60',
            ]"
            @click="toggleSelection(preset.id)"
          >
            <CardHeader class="py-2 px-3">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm font-semibold truncate">
                    {{ preset.name }}
                  </h3>
                  <p class="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    {{ preset.description }}
                  </p>
                </div>
                <div class="text-[10px] text-muted-foreground uppercase font-mono ml-2">
                  {{ preset.video.encoder }}
                </div>
              </div>
            </CardHeader>
            <CardContent class="px-3 pb-2 pt-0 text-[11px] text-muted-foreground space-y-1.5">
              <div class="flex items-center justify-between">
                <span>
                  {{ preset.video.rateControl.toUpperCase() }} {{ preset.video.qualityValue }}
                </span>
                <span v-if="preset.filters.scale">
                  {{ preset.filters.scale }}
                </span>
              </div>
              <div>
                <span class="font-mono">
                  {{ preset.audio.codec.toUpperCase() }}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div class="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/60">
        <div class="text-[11px] text-muted-foreground">
          {{ t("presets.presetCount", { count: presets.length }) }}
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-7 px-3 text-[11px]"
            @click="handleOpenToolsSettings"
          >
            {{ t("presets.openToolsSettingsFromOnboarding") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-3 text-[11px]"
            @click="handleCancel"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button
            size="sm"
            class="h-7 px-3 text-[11px]"
            :disabled="selectedIds.size === 0 || loading"
            @click="handleConfirm"
          >
            {{ t("common.next") }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
