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

  /**
   * 检测编码参数是否被修改（不包括名称、描述等元数据）
   * 用于判断是否应该清除智能推荐标记
   */
  const hasParametersChanged = (): boolean => {
    const stringify = (obj: unknown) => JSON.stringify(obj ?? {});
    // 比较各个参数配置是否与初始值相同
    if (stringify(global) !== stringify(initialPreset.global ?? {})) return true;
    if (stringify(input) !== stringify(initialPreset.input ?? {})) return true;
    if (stringify(mapping) !== stringify(initialPreset.mapping ?? {})) return true;
    if (stringify(video) !== stringify(initialPreset.video)) return true;
    if (stringify(audio) !== stringify(initialPreset.audio)) return true;
    if (stringify(filters) !== stringify(initialPreset.filters)) return true;
    if (stringify(subtitles) !== stringify(initialPreset.subtitles ?? {})) return true;
    if (stringify(container) !== stringify(initialPreset.container ?? {})) return true;
    if (stringify(hardware) !== stringify(initialPreset.hardware ?? {})) return true;
    if (advancedEnabled.value !== (initialPreset.advancedEnabled ?? false)) return true;
    if (ffmpegTemplate.value.trim() !== (initialPreset.ffmpegTemplate ?? "").trim()) return true;
    return false;
  };

  const buildPresetFromState = (): FFmpegPreset => {
    const normalizedVideo: VideoConfig = { ...(video as VideoConfig) };
    // 只在可以确定是 x264 专用取值时，才在非 x264 编码器上清理 tune，避免误删 NVENC/AV1 的 hq 等合法调优参数。
    if (normalizedVideo.encoder !== "libx264") {
      const rawTune = (normalizedVideo as any).tune as string | undefined;
      if (typeof rawTune === "string" && rawTune.trim().length > 0) {
        const x264OnlyTunes = [
          "film",
          "animation",
          "grain",
          "stillimage",
          "psnr",
          "ssim",
          "fastdecode",
          "zerolatency",
        ];
        if (x264OnlyTunes.includes(rawTune)) {
          delete (normalizedVideo as any).tune;
        }
      } else if (rawTune === undefined) {
        // 避免把 value 为 undefined 的 tune 透传给后端，保持结构简洁。
        delete (normalizedVideo as any).tune;
      }
    }

    // 判断是否保留智能推荐标记：
    // - 如果原始预设是智能预设且参数未被修改，保留标记 (true)
    // - 如果参数被修改了，显式清除标记 (false)，防止回退到 ID 前缀判断
    // - 名称和描述的修改不影响智能推荐标记
    const wasSmartPreset = initialPreset.isSmartPreset === true ||
      (typeof initialPreset.id === "string" && initialPreset.id.startsWith("smart-"));
    const parametersChanged = hasParametersChanged();
    // 如果原本是智能预设，需要显式设置 true 或 false；否则保持 undefined
    const isSmartPreset = wasSmartPreset ? !parametersChanged : undefined;

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
      isSmartPreset,
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
