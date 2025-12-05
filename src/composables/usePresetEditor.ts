import { computed, reactive, ref, type Ref, type ComputedRef } from "vue";
import type {
  FFmpegPreset,
  GlobalConfig,
  InputTimelineConfig,
  MappingConfig,
  VideoConfig,
  AudioConfig,
  FilterConfig,
  SubtitlesConfig,
  ContainerConfig,
  HardwareConfig,
} from "@/types";
import {
  highlightFfmpegCommand,
  normalizeFfmpegTemplate,
  getFfmpegCommandPreview,
} from "@/lib/ffmpegCommand";

// ----- Types -----

export interface PresetEditorState {
  name: Ref<string>;
  description: Ref<string>;
  global: GlobalConfig;
  input: InputTimelineConfig;
  mapping: MappingConfig;
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  subtitles: SubtitlesConfig;
  container: ContainerConfig;
  hardware: HardwareConfig;
  advancedEnabled: Ref<boolean>;
  ffmpegTemplate: Ref<string>;
  parseHint: Ref<string | null>;
  parseHintVariant: Ref<"neutral" | "ok" | "warning">;
}

export interface UsePresetEditorOptions {
  /** Initial preset to edit. */
  initialPreset: FFmpegPreset;
  /** Optional i18n translation function. */
  t?: (key: string, fallback?: string) => string;
}

export interface UsePresetEditorReturn {
  // ----- State -----
  name: Ref<string>;
  description: Ref<string>;
  global: GlobalConfig;
  input: InputTimelineConfig;
  mapping: MappingConfig;
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  subtitles: SubtitlesConfig;
  container: ContainerConfig;
  hardware: HardwareConfig;
  advancedEnabled: Ref<boolean>;
  ffmpegTemplate: Ref<string>;
  parseHint: Ref<string | null>;
  parseHintVariant: Ref<"neutral" | "ok" | "warning">;

  // ----- Computed -----
  /** Whether the encoder is set to 'copy'. */
  isCopyEncoder: ComputedRef<boolean>;
  /** Label for rate control field (CRF vs CQ). */
  rateControlLabel: ComputedRef<string>;
  /** FFmpeg command preview string. */
  commandPreview: ComputedRef<string>;
  /** Highlighted command preview HTML. */
  highlightedCommandHtml: ComputedRef<string>;
  /** CSS class for parse hint message. */
  parseHintClass: ComputedRef<string>;

  // ----- Methods -----
  /** Build preset object from current state. */
  buildPresetFromState: () => FFmpegPreset;
  /** Parse FFmpeg template from command string. */
  handleParseTemplateFromCommand: () => void;
}

/**
 * Composable for preset editor state and logic.
 * Manages form state, command preview, and template parsing.
 */
export function usePresetEditor(options: UsePresetEditorOptions): UsePresetEditorReturn {
  const { initialPreset, t } = options;

  // ----- State -----
  const name = ref(initialPreset.name);
  const description = ref(initialPreset.description ?? "");

  const global = reactive<GlobalConfig>({ ...(initialPreset.global ?? {}) });
  const input = reactive<InputTimelineConfig>({ ...(initialPreset.input ?? {}) });
  const mapping = reactive<MappingConfig>({ ...(initialPreset.mapping ?? {}) });
  const video = reactive<VideoConfig>({ ...(initialPreset.video as VideoConfig) });
  const audio = reactive<AudioConfig>({ ...(initialPreset.audio as AudioConfig) });
  const filters = reactive<FilterConfig>({ ...(initialPreset.filters as FilterConfig) });
  const subtitles = reactive<SubtitlesConfig>({ ...(initialPreset.subtitles ?? {}) });
  const container = reactive<ContainerConfig>({ ...(initialPreset.container ?? {}) });
  const hardware = reactive<HardwareConfig>({ ...(initialPreset.hardware ?? {}) });

  const advancedEnabled = ref<boolean>(initialPreset.advancedEnabled ?? false);
  const ffmpegTemplate = ref<string>(initialPreset.ffmpegTemplate ?? "");
  const parseHint = ref<string | null>(null);
  const parseHintVariant = ref<"neutral" | "ok" | "warning">("neutral");

  // ----- Computed -----

  const isCopyEncoder = computed(() => video.encoder === "copy");

  const rateControlLabel = computed(() => {
    if (video.encoder === "hevc_nvenc") {
      return t?.("presetEditor.video.cqLabel") ?? "CQ";
    }
    return t?.("presetEditor.video.crfLabel") ?? "CRF";
  });

  const commandPreview = computed(() => {
    return getFfmpegCommandPreview({
      global: global as GlobalConfig,
      input: input as InputTimelineConfig,
      mapping: mapping as MappingConfig,
      video: video as VideoConfig,
      audio: audio as AudioConfig,
      filters: filters as FilterConfig,
      subtitles: subtitles as SubtitlesConfig,
      container: container as ContainerConfig,
      hardware: hardware as HardwareConfig,
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

  // ----- Methods -----

  const buildPresetFromState = (): FFmpegPreset => {
    const normalizedVideo: VideoConfig = { ...(video as VideoConfig) };
    // Remove libx264-specific 'tune' field when using other encoders.
    if (normalizedVideo.encoder !== "libx264") {
      delete (normalizedVideo as any).tune;
    }

    return {
      id: initialPreset.id,
      name: name.value || (t?.("presetEditor.untitled") as string) || "Untitled Preset",
      description: description.value,
      global: { ...(global as GlobalConfig) },
      input: { ...(input as InputTimelineConfig) },
      mapping: { ...(mapping as MappingConfig) },
      video: normalizedVideo,
      audio: { ...(audio as AudioConfig) },
      filters: { ...(filters as FilterConfig) },
      subtitles: { ...(subtitles as SubtitlesConfig) },
      container: { ...(container as ContainerConfig) },
      hardware: { ...(hardware as HardwareConfig) },
      advancedEnabled: advancedEnabled.value && ffmpegTemplate.value.trim().length > 0,
      ffmpegTemplate: ffmpegTemplate.value.trim() || undefined,
      stats: initialPreset.stats,
    };
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
      parseHint.value =
        (t?.("presetEditor.advanced.parseEmpty") as string) ?? "";
      parseHintVariant.value = "warning";
      return;
    }

    const result = normalizeFfmpegTemplate(source);
    ffmpegTemplate.value = result.template;
    advancedEnabled.value = true;

    if (result.inputReplaced && result.outputReplaced) {
      parseHint.value =
        (t?.("presetEditor.advanced.parseOk") as string) ?? "";
      parseHintVariant.value = "ok";
    } else if (result.inputReplaced || result.outputReplaced) {
      parseHint.value =
        (t?.("presetEditor.advanced.parsePartial") as string) ?? "";
      parseHintVariant.value = "warning";
    } else {
      parseHint.value =
        (t?.("presetEditor.advanced.parseFailed") as string) ?? "";
      parseHintVariant.value = "warning";
    }
  };

  return {
    // State
    name,
    description,
    global,
    input,
    mapping,
    video,
    audio,
    filters,
    subtitles,
    container,
    hardware,
    advancedEnabled,
    ffmpegTemplate,
    parseHint,
    parseHintVariant,

    // Computed
    isCopyEncoder,
    rateControlLabel,
    commandPreview,
    highlightedCommandHtml,
    parseHintClass,

    // Methods
    buildPresetFromState,
    handleParseTemplateFromCommand,
  };
}

export default usePresetEditor;
