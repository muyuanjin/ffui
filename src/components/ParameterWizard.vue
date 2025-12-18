<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { AudioConfig, EncoderType, FFmpegPreset, FilterConfig, VideoConfig } from "../types";
import { ENCODER_OPTIONS, PRESET_OPTIONS } from "../constants";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import { highlightFfmpegCommand, normalizeFfmpegTemplate, getFfmpegCommandPreview } from "@/lib/ffmpegCommand";
import WizardStepBasics from "@/components/parameter-wizard/WizardStepBasics.vue";
import WizardStepVideo from "@/components/parameter-wizard/WizardStepVideo.vue";
import WizardStepFilters from "@/components/parameter-wizard/WizardStepFilters.vue";
import WizardStepAudio from "@/components/parameter-wizard/WizardStepAudio.vue";
import WizardStepAdvanced from "@/components/parameter-wizard/WizardStepAdvanced.vue";

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

const step = ref(1);
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
  ...(props.initialPreset?.video ?? defaultVideo),
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

const handleEncoderChange = (newEncoder: EncoderType) => {
  let defaults: Partial<VideoConfig> = {};

  if (newEncoder === "libx264") {
    defaults = {
      rateControl: "crf",
      qualityValue: 23,
      preset: "medium",
      tune: "film",
      profile: undefined,
    };
  } else if (newEncoder === "hevc_nvenc") {
    // NVENC 不支持 x264 的 -tune film 等参数，切换编码器时清理 tune / profile。
    defaults = {
      rateControl: "cq",
      qualityValue: 28,
      preset: "p5",
      tune: undefined,
      profile: undefined,
    };
  } else if (newEncoder === "libsvtav1") {
    defaults = {
      rateControl: "crf",
      qualityValue: 34,
      preset: "5",
      tune: undefined,
      profile: undefined,
    };
  } else if (newEncoder === "copy") {
    Object.assign(audio, { codec: "copy" });
    defaults = {
      rateControl: "cbr",
      qualityValue: 0,
      preset: "",
      tune: undefined,
      profile: undefined,
    };
  }

  Object.assign(video, {
    encoder: newEncoder,
    ...defaults,
  });
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
  // 防止把 x264 的 tune 选项带到 NVENC/AV1 预设里，从而生成非法 ffmpeg 参数。
  const normalizedVideo: VideoConfig = { ...(video as VideoConfig) };
  if (normalizedVideo.encoder !== "libx264") {
    delete (normalizedVideo as any).tune;
  }

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

const handleSave = () => {
  emit("save", buildPresetFromState());
};

const handleSwitchToPanel = () => {
  emit("switchToPanel", buildPresetFromState());
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

const rateControlLabel = computed(() => {
  if (video.encoder === "hevc_nvenc") {
    return t("presetEditor.video.cqLabel");
  }
  return t("presetEditor.video.crfLabel");
});

const commandPreview = computed(() => {
  return getFfmpegCommandPreview({
    video: video as VideoConfig,
    audio: audio as AudioConfig,
    filters: filters as FilterConfig,
    advancedEnabled: advancedEnabled.value,
    ffmpegTemplate: ffmpegTemplate.value,
  });
});

const highlightedCommandHtml = computed(() => highlightFfmpegCommand(commandPreview.value));

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
            {{ t("common.stepOf", { step, total: 5 }) }}
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
        <WizardStepBasics
          v-if="step === 1"
          v-model:name="name"
          v-model:description="description"
          :t="t"
          @select-recipe="handleRecipeSelect"
        />

        <WizardStepVideo
          v-else-if="step === 2"
          :video="video"
          :encoder-options="ENCODER_OPTIONS"
          :preset-options="PRESET_OPTIONS"
          :rate-control-label="rateControlLabel"
          :is-copy-encoder="isCopyEncoder"
          :t="t"
          @change-encoder="handleEncoderChange"
          @update-video="applyVideoPatch"
        />

        <WizardStepFilters
          v-else-if="step === 3"
          :filters="filters"
          :is-copy-encoder="isCopyEncoder"
          :t="t"
          @update-filters="applyFiltersPatch"
        />

        <WizardStepAudio
          v-else-if="step === 4"
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
          :highlighted-command-html="highlightedCommandHtml"
          :parse-hint="parseHint"
          :parse-hint-class="parseHintClass"
          :t="t"
          @update-advanced-enabled="(value) => (advancedEnabled = value)"
          @update-template="(value) => (ffmpegTemplate = value)"
          @parse-template="handleParseTemplateFromCommand"
          @copy-preview="handleCopyPreview"
        />
      </div>

      <div class="p-6 border-t border-border bg-muted/60 flex justify-between rounded-b-xl">
        <Button
          v-if="step > 1"
          variant="ghost"
          class="px-4 py-2 text-muted-foreground hover:text-foreground font-medium"
          @click="step -= 1"
        >
          {{ t("common.back") }}
        </Button>
        <div v-else />

        <Button
          v-if="step < 5"
          class="px-6 py-2 font-medium flex items-center gap-2 transition-colors"
          @click="step += 1"
        >
          {{ t("common.next") }} →
        </Button>
        <Button v-else class="px-6 py-2 font-medium flex items-center gap-2 transition-colors" @click="handleSave">
          {{ initialPreset ? t("presetEditor.actions.update") : t("presetEditor.actions.save") }}
        </Button>
      </div>
    </div>
  </div>
</template>
