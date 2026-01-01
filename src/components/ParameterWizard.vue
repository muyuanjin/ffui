<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { AudioConfig, EncoderType, FFmpegPreset, FilterConfig, VideoConfig } from "../types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "../constants";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import { highlightFfmpegCommandTokens, normalizeFfmpegTemplate, getFfmpegCommandPreview } from "@/lib/ffmpegCommand";
import { validatePresetTemplate } from "@/lib/backend";
import { applyEncoderChangePatch, normalizeVideoForSave } from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import { normalizePreset } from "@/lib/presetEditorContract/presetDerivation";
import WizardStepBasics from "@/components/parameter-wizard/WizardStepBasics.vue";
import WizardStepVideo from "@/components/parameter-wizard/WizardStepVideo.vue";
import WizardStepFilters from "@/components/parameter-wizard/WizardStepFilters.vue";
import WizardStepAudio from "@/components/parameter-wizard/WizardStepAudio.vue";
import WizardStepAdvanced from "@/components/parameter-wizard/WizardStepAdvanced.vue";
import WizardStepPresetKind, { type PresetKind } from "@/components/parameter-wizard/WizardStepPresetKind.vue";
import type { PresetTemplateValidationResult } from "@/types";

const props = defineProps<{
  initialPreset?: FFmpegPreset | null;
}>();

const emit = defineEmits<{
  (e: "save", value: FFmpegPreset): void;
  (e: "cancel"): void;
  // When editing an existing preset, allow switching to the full parameter panel
  // while preserving the current wizard state.
  (e: "switchToPanel", value: FFmpegPreset): void;
}>();

const { t } = useI18n();

const isEditing = computed(() => !!props.initialPreset);
const step = ref(isEditing.value ? 2 : 1);
const presetKind = ref<PresetKind>("structured");

const DEFAULT_CUSTOM_TEMPLATE = "-hide_banner -i INPUT -c:v libx264 -crf 23 -preset medium -c:a copy OUTPUT";

const name = ref(props.initialPreset?.name ?? "");
const description = ref(props.initialPreset?.description ?? "");

const defaultVideo: VideoConfig = {
  encoder: "libx264",
  rateControl: "crf",
  qualityValue: 23,
  preset: "medium",
  tune: "film",
};

const video = reactive<VideoConfig>({
  ...(props.initialPreset ? normalizePreset(props.initialPreset).preset.video : defaultVideo),
});
const audio = reactive<AudioConfig>({
  ...(props.initialPreset?.audio ?? {
    codec: "copy",
    bitrate: 192,
  }),
});
const filters = reactive<FilterConfig>({
  ...(props.initialPreset?.filters ?? {}),
});

const advancedEnabled = ref<boolean>(props.initialPreset?.advancedEnabled ?? false);
const ffmpegTemplate = ref<string>(props.initialPreset?.ffmpegTemplate ?? "");
const parseHint = ref<string | null>(null);
const parseHintVariant = ref<"neutral" | "ok" | "warning">("neutral");

const isCustomCommandPreset = computed<boolean>(() => advancedEnabled.value && ffmpegTemplate.value.trim().length > 0);

if (props.initialPreset) {
  presetKind.value = isCustomCommandPreset.value ? "custom" : "structured";
}

const isCustomFlow = computed(() => !isEditing.value && presetKind.value === "custom");

const displayTotalSteps = computed<number>(() => {
  if (isEditing.value) return 5;
  if (isCustomFlow.value) return 2;
  return 6;
});

const displayStepIndex = computed<number>(() => {
  if (isEditing.value) return Math.max(1, step.value - 1);
  if (!isCustomFlow.value) return step.value;
  return step.value === 1 ? 1 : 2;
});

const canGoBack = computed<boolean>(() => {
  if (isEditing.value) return step.value > 2;
  if (isCustomFlow.value) return step.value !== 1;
  return step.value > 1;
});

const canGoNext = computed<boolean>(() => {
  if (isCustomFlow.value) return step.value === 1;
  return step.value < 6;
});

const isCustomTemplateValid = computed<boolean>(() => {
  if (!isCustomFlow.value && !isCustomCommandPreset.value) return true;
  const template = ffmpegTemplate.value.trim();
  if (!template) return false;
  return template.includes("INPUT") && template.includes("OUTPUT");
});

const canSave = computed<boolean>(() => {
  if (isEditing.value) return true;
  if (presetKind.value !== "custom") return true;
  return isCustomTemplateValid.value;
});

const handleEncoderChange = (newEncoder: EncoderType) => {
  if (newEncoder === "copy") {
    Object.assign(audio, { codec: "copy" });
  }
  Object.assign(video, applyEncoderChangePatch(video as VideoConfig, newEncoder));
};

const applyVideoPatch = (patch: Partial<VideoConfig>) => {
  Object.assign(video, patch);
};

const applyAudioPatch = (patch: Partial<AudioConfig>) => {
  Object.assign(audio, patch);
};

const applyFiltersPatch = (patch: Partial<FilterConfig>) => {
  Object.assign(filters, patch);
};

const buildPresetFromState = (): FFmpegPreset => {
  const normalizedVideo = normalizeVideoForSave({ ...(video as VideoConfig) });
  if (normalizedVideo.tune === undefined) delete (normalizedVideo as any).tune;

  const newPreset: FFmpegPreset = {
    id: props.initialPreset?.id ?? Date.now().toString(),
    name: name.value || (t("presetEditor.untitled") as string),
    description: description.value,
    global: props.initialPreset?.global ?? {
      hideBanner: true,
    },
    video: normalizedVideo,
    audio: { ...audio } as AudioConfig,
    filters: { ...filters } as FilterConfig,
    advancedEnabled: advancedEnabled.value && ffmpegTemplate.value.trim().length > 0,
    ffmpegTemplate: ffmpegTemplate.value.trim() || undefined,
    stats: props.initialPreset?.stats ?? {
      usageCount: 0,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
    },
  };

  return newPreset;
};

const quickValidateBusy = ref(false);
const quickValidateResult = ref<PresetTemplateValidationResult | null>(null);
watch([advancedEnabled, ffmpegTemplate], () => {
  quickValidateResult.value = null;
});

const handleQuickValidate = async () => {
  if (quickValidateBusy.value) return;
  quickValidateBusy.value = true;
  try {
    quickValidateResult.value = await validatePresetTemplate(buildPresetFromState());
  } finally {
    quickValidateBusy.value = false;
  }
};

const handleSave = () => {
  if (!canSave.value) return;
  emit("save", buildPresetFromState());
};

const handleSwitchToPanel = () => {
  emit("switchToPanel", buildPresetFromState());
};

const handleKindChange = (kind: PresetKind) => {
  presetKind.value = kind;
  if (kind === "custom") {
    advancedEnabled.value = true;
    if (!ffmpegTemplate.value.trim()) {
      ffmpegTemplate.value = DEFAULT_CUSTOM_TEMPLATE;
    }
  }
};

const goNext = () => {
  if (isCustomFlow.value) {
    if (step.value === 1) {
      step.value = 2;
      return;
    }
  }
  if (step.value < 6) step.value += 1;
};

const goBack = () => {
  if (isCustomFlow.value) {
    if (step.value === 2) {
      step.value = 1;
      return;
    }
  }
  if (isEditing.value) {
    if (step.value > 2) step.value -= 1;
    return;
  }
  if (step.value > 1) step.value -= 1;
};

const handleRecipeSelect = ({
  name: nextName,
  description: nextDescription,
  video: videoPatch,
  audio: audioPatch,
  nextStep,
  advancedEnabled: nextAdvancedEnabled,
  ffmpegTemplate: nextTemplate,
}: {
  name: string;
  description: string;
  video: Partial<VideoConfig>;
  audio?: Partial<AudioConfig>;
  nextStep?: number;
  advancedEnabled?: boolean;
  ffmpegTemplate?: string;
}) => {
  name.value = nextName;
  description.value = nextDescription;
  applyVideoPatch(videoPatch);
  if (audioPatch) {
    applyAudioPatch(audioPatch);
  }
  // 当配方明确指定高级模板时，直接切换到高级模式，并用给定模板覆盖现有内容。
  if (typeof nextAdvancedEnabled === "boolean") {
    advancedEnabled.value = nextAdvancedEnabled;
  }
  if (typeof nextTemplate === "string") {
    ffmpegTemplate.value = nextTemplate;
  }
  step.value = nextStep ?? step.value;
};

const isCopyEncoder = computed(() => video.encoder === "copy");

const commandPreview = computed(() => {
  return getFfmpegCommandPreview({
    video: video as VideoConfig,
    audio: audio as AudioConfig,
    filters: filters as FilterConfig,
    advancedEnabled: advancedEnabled.value,
    ffmpegTemplate: ffmpegTemplate.value,
  });
});

const highlightedCommandTokens = computed(() => highlightFfmpegCommandTokens(commandPreview.value));

const parseHintClass = computed(() => {
  if (!parseHint.value) {
    return "text-[10px] text-muted-foreground";
  }
  if (parseHintVariant.value === "ok") {
    return "text-[10px] text-emerald-400";
  }
  if (parseHintVariant.value === "warning") {
    return "text-[10px] text-amber-400";
  }
  return "text-[10px] text-muted-foreground";
});

const handleCopyPreview = async () => {
  try {
    await navigator.clipboard?.writeText(commandPreview.value);
    // silent success; in future can wire to toast using t("presetEditor.advanced.copiedToast")
  } catch {
    // ignore clipboard failures
  }
};

const handleParseTemplateFromCommand = () => {
  const source =
    ffmpegTemplate.value.trim() ||
    getFfmpegCommandPreview({
      video: video as VideoConfig,
      audio: audio as AudioConfig,
      filters: filters as FilterConfig,
      advancedEnabled: false,
      ffmpegTemplate: "",
    });
  if (!source) {
    parseHint.value = t("presetEditor.advanced.parseEmpty") as string;
    parseHintVariant.value = "warning";
    return;
  }

  const result = normalizeFfmpegTemplate(source);
  ffmpegTemplate.value = result.template;
  advancedEnabled.value = true;

  if (result.inputReplaced && result.outputReplaced) {
    parseHint.value = t("presetEditor.advanced.parseOk") as string;
    parseHintVariant.value = "ok";
  } else if (result.inputReplaced || result.outputReplaced) {
    parseHint.value = t("presetEditor.advanced.parsePartial") as string;
    parseHintVariant.value = "warning";
  } else {
    parseHint.value = t("presetEditor.advanced.parseFailed") as string;
    parseHintVariant.value = "warning";
  }
};
</script>

<template>
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
    <div class="bg-background w-full max-w-2xl rounded-xl shadow-2xl border border-border flex flex-col max-h-[90vh]">
      <div class="p-6 border-b border-border flex justify-between items-center">
        <div>
          <h2 class="text-xl font-bold text-white">
            {{ initialPreset ? t("presetEditor.titleEdit") : t("presetEditor.titleNew") }}
          </h2>
          <p class="text-muted-foreground text-sm">
            {{ t("common.stepOf", { step: displayStepIndex, total: displayTotalSteps }) }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8 px-3 text-[11px]"
            data-testid="preset-open-panel"
            @click="handleSwitchToPanel"
          >
            {{ t("presetEditor.actions.openPanel") }}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="text-muted-foreground hover:text-foreground"
            @click="emit('cancel')"
          >
            ✕
          </Button>
        </div>
      </div>

      <div class="p-6 overflow-y-auto flex-1 space-y-6">
        <WizardStepPresetKind
          v-if="!initialPreset && step === 1"
          v-model:kind="presetKind"
          :t="t"
          @update:kind="handleKindChange"
        />

        <template v-else-if="step === 2">
          <WizardStepBasics
            v-model:name="name"
            v-model:description="description"
            :show-recipes="presetKind !== 'custom'"
            :t="t"
            @select-recipe="handleRecipeSelect"
          />
          <div v-if="isCustomFlow" class="pt-6">
            <WizardStepAdvanced
              :video="video"
              :audio="audio"
              :filters="filters"
              :advanced-enabled="advancedEnabled"
              :ffmpeg-template="ffmpegTemplate"
              :highlighted-command-tokens="highlightedCommandTokens"
              :parse-hint="parseHint"
              :parse-hint-class="parseHintClass"
              :t="t"
              :show-summary="false"
              :show-toggle="false"
              :quick-validate-busy="quickValidateBusy"
              :quick-validate-result="quickValidateResult"
              @update-advanced-enabled="(value) => (advancedEnabled = value)"
              @update-template="(value) => (ffmpegTemplate = value)"
              @parse-template="handleParseTemplateFromCommand"
              @copy-preview="handleCopyPreview"
              @quick-validate="handleQuickValidate"
            />
          </div>
        </template>

        <WizardStepVideo
          v-else-if="step === 3"
          :video="video"
          :encoder-options="ENCODER_OPTIONS"
          :preset-options="PRESET_OPTIONS"
          :is-copy-encoder="isCopyEncoder"
          :t="t"
          @change-encoder="handleEncoderChange"
          @update-video="applyVideoPatch"
        />

        <WizardStepFilters
          v-else-if="step === 4"
          :filters="filters"
          :is-copy-encoder="isCopyEncoder"
          :t="t"
          @update-filters="applyFiltersPatch"
        />

        <WizardStepAudio
          v-else-if="step === 5"
          :audio="audio"
          :is-copy-encoder="isCopyEncoder"
          :t="t"
          @update-audio="applyAudioPatch"
        />

        <WizardStepAdvanced
          v-else
          :video="video"
          :audio="audio"
          :filters="filters"
          :advanced-enabled="advancedEnabled"
          :ffmpeg-template="ffmpegTemplate"
          :highlighted-command-tokens="highlightedCommandTokens"
          :parse-hint="parseHint"
          :parse-hint-class="parseHintClass"
          :t="t"
          :quick-validate-busy="quickValidateBusy"
          :quick-validate-result="quickValidateResult"
          @update-advanced-enabled="(value) => (advancedEnabled = value)"
          @update-template="(value) => (ffmpegTemplate = value)"
          @parse-template="handleParseTemplateFromCommand"
          @copy-preview="handleCopyPreview"
          @quick-validate="handleQuickValidate"
        />
      </div>

      <div class="p-6 border-t border-border bg-muted/60 flex justify-between rounded-b-xl">
        <Button
          v-if="canGoBack"
          variant="ghost"
          class="px-4 py-2 text-muted-foreground hover:text-foreground font-medium"
          @click="goBack"
        >
          {{ t("common.back") }}
        </Button>
        <div v-else />

        <Button
          v-if="canGoNext"
          class="px-6 py-2 font-medium flex items-center gap-2 transition-colors"
          @click="goNext"
        >
          {{ t("common.next") }} →
        </Button>
        <Button
          v-else
          class="px-6 py-2 font-medium flex items-center gap-2 transition-colors"
          :disabled="!canSave"
          @click="handleSave"
        >
          {{ initialPreset ? t("presetEditor.actions.update") : t("presetEditor.actions.save") }}
        </Button>
      </div>
    </div>
  </div>
</template>
