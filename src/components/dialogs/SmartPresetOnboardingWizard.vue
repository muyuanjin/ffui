<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { loadSmartDefaultPresets } from "@/lib/backend";
import { resolvePresetDescription } from "@/lib/presetLocalization";
import { computePresetInsights } from "@/lib/presetInsights";
import type { FFmpegPreset } from "@/types";
import SmartPresetOnboardingWizardPresetsStep from "./smart-preset-onboarding/SmartPresetOnboardingWizardPresetsStep.vue";
import {
  classifyCodec,
  classifyUseCase,
  isAdvancedPreset,
  type CodecPreference,
  type UseCasePreference,
} from "./smart-preset-onboarding/presetFilters";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "confirmed", presets: FFmpegPreset[]): void;
  (e: "openToolsSettings"): void;
}>();

const { t, locale } = useI18n();

// 向导步骤
type WizardStep = "welcome" | "codec" | "useCase" | "presets" | "confirm";
const currentStep = ref<WizardStep>("welcome");
const steps: WizardStep[] = ["welcome", "codec", "useCase", "presets", "confirm"];

// 加载状态
const loading = ref(false);
const error = ref<string | null>(null);
const allPresets = ref<FFmpegPreset[]>([]);

// 用户选择
const codecPreference = ref<CodecPreference>("auto");
const useCasePreference = ref<UseCasePreference>("daily");
const selectedIds = ref<Set<string>>(new Set());

// 硬件检测结果
// 仅当存在 NVENC 编码器（*_nvenc）时，才认为 NVENC 可用，避免把 QSV/AMF 之类误判为“支持 NVENC”
const nvencAvailable = computed(() =>
  allPresets.value.some(
    (p) => typeof p.video?.encoder === "string" && (p.video.encoder as string).toLowerCase().includes("nvenc"),
  ),
);

const av1Available = computed(() =>
  allPresets.value.some(
    (p) => typeof p.video?.encoder === "string" && (p.video.encoder as string).toLowerCase().includes("av1"),
  ),
);

const codecOptions = computed(() => [
  {
    value: "auto",
    icon: "🎯",
    title: t("presets.codecPreferenceAuto"),
    desc: t("onboarding.codecAutoDesc"),
  },
  {
    value: "h264",
    icon: "📹",
    title: t("presets.codecPreferenceH264"),
    desc: t("onboarding.codecH264Desc"),
  },
  {
    value: "hevc",
    icon: "🎥",
    title: t("presets.codecPreferenceHevc"),
    desc: t("onboarding.codecHevcDesc"),
    disabled: !nvencAvailable.value,
  },
  {
    value: "av1",
    icon: "🚀",
    title: t("presets.codecPreferenceAv1"),
    desc: t("onboarding.codecAv1Desc"),
  },
]);

const useCaseOptions = computed(() => [
  {
    value: "share",
    icon: "📤",
    title: t("presets.useCasePreferenceShare"),
    desc: t("onboarding.useCaseShareDesc"),
  },
  {
    value: "daily",
    icon: "📁",
    title: t("presets.useCasePreferenceDaily"),
    desc: t("onboarding.useCaseDailyDesc"),
  },
  {
    value: "archive",
    icon: "💾",
    title: t("presets.useCasePreferenceArchive"),
    desc: t("onboarding.useCaseArchiveDesc"),
  },
]);

// 用途分类
const resolveDescription = (preset: FFmpegPreset): string => resolvePresetDescription(preset, locale.value);

// 根据用户选择筛选预设
const filteredPresets = computed(() => {
  if (allPresets.value.length === 0) return [];

  return allPresets.value.filter((preset) => {
    const codec = classifyCodec(preset.video.encoder as string);
    const use = classifyUseCase(preset, resolveDescription(preset));

    // 编码器筛选
    if (codecPreference.value !== "auto" && codec !== codecPreference.value) {
      return false;
    }

    // 用途筛选
    if (useCasePreference.value === "share" && use !== "share") {
      return false;
    }
    if (useCasePreference.value === "archive" && use !== "archive") {
      return false;
    }
    // "daily" 保留所有类型

    return true;
  });
});

// 当筛选条件变化时，自动更新选中状态
watch([codecPreference, useCasePreference], () => {
  // 只保留仍在筛选结果中的选中项
  const filteredIds = new Set(filteredPresets.value.map((p) => p.id));
  const newSelected = new Set<string>();
  for (const id of selectedIds.value) {
    if (filteredIds.has(id)) {
      newSelected.add(id);
    }
  }
  selectedIds.value = newSelected;
});

// 当进入预设选择步骤时，默认全选
watch(currentStep, (step) => {
  if (step === "presets" && selectedIds.value.size === 0) {
    const candidates = filteredPresets.value;
    const primary = candidates.filter((p) => !isAdvancedPreset(p, resolveDescription(p)));
    const base = primary.length > 0 ? primary : candidates;
    selectedIds.value = new Set(base.map((p) => p.id));
  }
});

// 步骤导航
const currentStepIndex = computed(() => steps.indexOf(currentStep.value));
const canGoBack = computed(() => currentStepIndex.value > 0);
const canGoNext = computed(() => {
  if (currentStep.value === "presets") {
    return selectedIds.value.size > 0;
  }
  return currentStepIndex.value < steps.length - 1;
});

const goBack = () => {
  if (canGoBack.value) {
    currentStep.value = steps[currentStepIndex.value - 1];
  }
};

const goNext = () => {
  if (currentStep.value === "confirm") {
    handleConfirm();
    return;
  }
  if (canGoNext.value) {
    currentStep.value = steps[currentStepIndex.value + 1];
  }
};

// 加载预设
const fetchSmartPresets = async () => {
  if (!props.open) return;
  loading.value = true;
  error.value = null;
  allPresets.value = [];
  selectedIds.value = new Set();
  try {
    const list = await loadSmartDefaultPresets();
    allPresets.value = Array.isArray(list) ? list : [];
  } catch (err: any) {
    console.error("failed to load smart default presets", err);
    error.value = String(err?.message ?? err ?? "Unknown error");
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    currentStep.value = "welcome";
    codecPreference.value = "auto";
    useCasePreference.value = "daily";
    void fetchSmartPresets();
  },
  { immediate: true },
);

// 预设选择操作
const toggleSelection = (id: string) => {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
};

const selectAll = () => {
  selectedIds.value = new Set(filteredPresets.value.map((p) => p.id));
};

const deselectAll = () => {
  selectedIds.value = new Set();
};

// 确认导入
const handleConfirm = () => {
  const chosen = allPresets.value.filter((p) => selectedIds.value.has(p.id));
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

// 获取选中的预设列表（用于确认页）
const selectedPresets = computed(() => allPresets.value.filter((p) => selectedIds.value.has(p.id)));

// 为智能向导中的预设卡片提供简化版“场景标签”和“体积风险”提示
const getPresetScenarioLabel = (preset: FFmpegPreset): string => {
  const insights = computePresetInsights(preset);
  return t(`presetEditor.panel.scenario.${insights.scenario}`);
};

const getPresetRiskBadge = (preset: FFmpegPreset): string | null => {
  const insights = computePresetInsights(preset);
  return insights.mayIncreaseSize ? t("presets.mayIncreaseSizeShort") : null;
};
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent
      :portal-disabled="true"
      :portal-force-mount="true"
      :hide-close="true"
      overlay-class="bg-black/70"
      class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 p-0 outline-none border-0 bg-transparent shadow-none gap-0"
      data-testid="preset-setup-wizard"
      @pointer-down-outside="(event) => event.preventDefault()"
    >
      <DialogDescription class="sr-only">
        {{ t("onboarding.welcomeDescription") }}
      </DialogDescription>
      <div class="bg-background w-full rounded-xl shadow-2xl border border-border flex flex-col max-h-[85vh]">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex items-center justify-between mb-3">
            <DialogTitle class="text-lg font-semibold">{{ t("onboarding.title") }}</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              data-testid="preset-setup-wizard-close"
              @click="handleCancel"
            >
              ✕
            </Button>
          </div>
          <div class="flex items-center gap-2">
            <template v-for="(_, index) in steps" :key="index">
              <div
                :class="[
                  'h-1.5 flex-1 rounded-full transition-colors',
                  index <= currentStepIndex ? 'bg-primary' : 'bg-muted',
                ]"
              />
            </template>
          </div>
          <p class="text-xs text-muted-foreground mt-2">
            {{ t("common.stepOf", { step: currentStepIndex + 1, total: steps.length }) }}
          </p>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-5">
          <div v-if="currentStep === 'welcome'" class="space-y-4" data-testid="preset-setup-wizard-step-welcome">
            <div class="text-center py-4">
              <div class="text-4xl mb-4">🎬</div>
              <h3 class="text-xl font-bold mb-2">{{ t("onboarding.welcomeTitle") }}</h3>
              <p class="text-muted-foreground text-sm max-w-md mx-auto">{{ t("onboarding.welcomeDescription") }}</p>
            </div>
            <div class="bg-muted/50 rounded-lg p-4 space-y-2">
              <h4 class="text-sm font-medium flex items-center gap-2">
                <span>🔍</span>{{ t("onboarding.hardwareDetection") }}
              </h4>
              <div class="text-xs text-muted-foreground space-y-1">
                <div v-if="loading" class="flex items-center gap-2">
                  <Spinner class="size-4" />{{ t("common.loading") }}
                </div>
                <template v-else-if="!error">
                  <div class="flex items-center gap-2">
                    <span :class="nvencAvailable ? 'text-green-500' : 'text-yellow-500'">{{
                      nvencAvailable ? "✓" : "○"
                    }}</span>
                    {{ nvencAvailable ? t("onboarding.nvencDetected") : t("onboarding.nvencNotDetected") }}
                  </div>
                  <div class="flex items-center gap-2">
                    <span :class="av1Available ? 'text-green-500' : 'text-yellow-500'">{{
                      av1Available ? "✓" : "○"
                    }}</span>
                    {{ av1Available ? t("onboarding.av1Detected") : t("onboarding.av1NotDetected") }}
                  </div>
                </template>
                <div v-else class="text-destructive">{{ error }}</div>
              </div>
            </div>
          </div>

          <div v-else-if="currentStep === 'codec'" class="space-y-4" data-testid="preset-setup-wizard-step-codec">
            <div class="text-center mb-6">
              <h3 class="text-lg font-bold mb-1">{{ t("onboarding.codecTitle") }}</h3>
              <p class="text-muted-foreground text-sm">{{ t("onboarding.codecDescription") }}</p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <Card
                v-for="option in codecOptions"
                :key="option.value"
                :class="[
                  'cursor-pointer transition-all',
                  codecPreference === option.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/50',
                  option.disabled ? 'opacity-50' : '',
                ]"
                @click="!option.disabled && (codecPreference = option.value as CodecPreference)"
              >
                <CardContent class="p-4">
                  <div class="text-2xl mb-2">{{ option.icon }}</div>
                  <h4 class="font-medium text-sm">{{ option.title }}</h4>
                  <p class="text-xs text-muted-foreground mt-1">{{ option.desc }}</p>
                  <div v-if="option.disabled" class="text-xs text-yellow-500 mt-2">
                    {{ t("onboarding.requiresNvenc") }}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div v-else-if="currentStep === 'useCase'" class="space-y-4" data-testid="preset-setup-wizard-step-useCase">
            <div class="text-center mb-6">
              <h3 class="text-lg font-bold mb-1">{{ t("onboarding.useCaseTitle") }}</h3>
              <p class="text-muted-foreground text-sm">{{ t("onboarding.useCaseDescription") }}</p>
            </div>

            <div class="space-y-3">
              <Card
                v-for="option in useCaseOptions"
                :key="option.value"
                :class="[
                  'cursor-pointer transition-all',
                  useCasePreference === option.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-primary/50',
                ]"
                @click="useCasePreference = option.value as UseCasePreference"
              >
                <CardContent class="p-4 flex items-start gap-4">
                  <div class="text-3xl">{{ option.icon }}</div>
                  <div class="flex-1">
                    <h4 class="font-medium">{{ option.title }}</h4>
                    <p class="text-sm text-muted-foreground mt-1">{{ option.desc }}</p>
                  </div>
                  <div
                    :class="[
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      useCasePreference === option.value ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                    ]"
                  >
                    <span v-if="useCasePreference === option.value" class="text-white text-xs">✓</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <SmartPresetOnboardingWizardPresetsStep
            v-else-if="currentStep === 'presets'"
            :filtered-presets="filteredPresets"
            :selected-ids="selectedIds"
            :resolve-description="resolveDescription"
            :get-preset-scenario-label="getPresetScenarioLabel"
            :get-preset-risk-badge="getPresetRiskBadge"
            @toggle="toggleSelection"
            @select-all="selectAll"
            @deselect-all="deselectAll"
          />

          <div v-else-if="currentStep === 'confirm'" class="space-y-4" data-testid="preset-setup-wizard-step-confirm">
            <div class="text-center py-4">
              <div class="text-4xl mb-4">✅</div>
              <h3 class="text-xl font-bold mb-2">{{ t("onboarding.confirmTitle") }}</h3>
              <p class="text-muted-foreground text-sm">
                {{ t("onboarding.confirmDescription", { count: selectedIds.size }) }}
              </p>
            </div>

            <div class="bg-muted/50 rounded-lg p-4">
              <h4 class="text-sm font-medium mb-3">{{ t("onboarding.selectedPresets") }}</h4>
              <div class="space-y-2 max-h-[30vh] overflow-y-auto">
                <div
                  v-for="preset in selectedPresets"
                  :key="preset.id"
                  class="flex items-center justify-between text-sm py-1.5 px-2 bg-background rounded"
                >
                  <span class="truncate">{{ preset.name }}</span>
                  <span class="text-xs text-muted-foreground font-mono">{{ preset.video.encoder }}</span>
                </div>
              </div>
            </div>

            <div class="pt-2">
              <Button
                variant="outline"
                size="sm"
                class="w-full justify-start text-xs h-9"
                @click="handleOpenToolsSettings"
              >
                <span class="mr-2">⚙️</span>
                {{ t("presets.openToolsSettingsFromOnboarding") }}
              </Button>
            </div>
          </div>
        </div>

        <div class="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-between">
          <Button v-if="canGoBack" variant="ghost" size="sm" class="h-8" @click="goBack"
            >← {{ t("common.back") }}</Button
          >
          <div v-else />
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" class="h-8 text-muted-foreground" @click="handleCancel">
              {{ t("common.cancel") }}
            </Button>
            <Button
              size="sm"
              class="h-8 px-4"
              data-testid="preset-setup-wizard-next"
              :disabled="currentStep === 'presets' && selectedIds.size === 0"
              @click="goNext"
            >
              {{ currentStep === "confirm" ? t("onboarding.importButton") : t("common.next")
              }}<span v-if="currentStep !== 'confirm'" class="ml-1">→</span>
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
