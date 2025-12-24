import { computePresetInsights } from "@/lib/presetInsights";
import { resolvePresetDescription } from "@/lib/presetLocalization";
import type { FFmpegPreset } from "@/types";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export const isSmartPreset = (preset: FFmpegPreset): boolean => {
  if (typeof preset.isSmartPreset === "boolean") {
    return preset.isSmartPreset;
  }
  return typeof preset.id === "string" && preset.id.startsWith("smart-");
};

export const isCustomCommandPreset = (preset: FFmpegPreset): boolean => {
  return Boolean(preset.advancedEnabled && preset.ffmpegTemplate && preset.ffmpegTemplate.trim().length > 0);
};

export const getPresetDescription = (preset: FFmpegPreset, locale: string): string =>
  resolvePresetDescription(preset, locale);

export const getPresetScenarioLabel = (preset: FFmpegPreset, t: TranslateFn): string => {
  const insights = computePresetInsights(preset);
  return t(`presetEditor.panel.scenario.${insights.scenario}`);
};

export const getPresetRiskBadge = (preset: FFmpegPreset, t: TranslateFn): string | null => {
  const insights = computePresetInsights(preset);
  return insights.mayIncreaseSize ? t("presets.mayIncreaseSizeShort") : null;
};

export const getRatioColorClass = (ratio: number | null): string => {
  if (ratio === null) return "text-primary";
  if (ratio < 100) return "text-emerald-400";
  if (ratio < 200) return "text-amber-400";
  return "text-red-400";
};

export const getVideoRateControlSummary = (video: FFmpegPreset["video"]): string => {
  const mode = video.rateControl;
  if (mode === "crf") return `CRF ${video.qualityValue}`;
  if (mode === "cq") return `CQ ${video.qualityValue}`;
  if (mode === "constqp") return `ConstQP ${video.qualityValue}`;
  if (mode === "cbr") {
    return typeof video.bitrateKbps === "number" && video.bitrateKbps > 0 ? `CBR ${video.bitrateKbps}k` : "CBR";
  }
  if (mode === "vbr") {
    return typeof video.bitrateKbps === "number" && video.bitrateKbps > 0 ? `VBR ${video.bitrateKbps}k` : "VBR";
  }
  return String(mode).toUpperCase();
};

export const getFiltersSummary = (preset: FFmpegPreset, t: TranslateFn): string => {
  const parts: string[] = [];
  if (preset.filters.scale) parts.push(`${t("presets.scale")}: ${preset.filters.scale}`);
  if (preset.filters.crop) parts.push(`${t("presets.crop")}: ${preset.filters.crop}`);
  if (preset.filters.fps) parts.push(`${t("presets.fps")}: ${preset.filters.fps}`);
  return parts.length > 0 ? parts.join(", ") : t("presets.noFilters");
};

export const getSubtitleSummary = (preset: FFmpegPreset, t: TranslateFn): string => {
  // 兼容旧预设：存在 subtitles 对象但未显式设置 strategy 时，视为“保留”
  if (!preset.subtitles || !preset.subtitles.strategy || preset.subtitles.strategy === "keep") {
    return t("presets.subtitleKeep");
  }
  if (preset.subtitles.strategy === "drop") return t("presets.subtitleDrop");
  return t("presets.subtitleBurnIn");
};

export const getAudioSummary = (audio: FFmpegPreset["audio"], t: TranslateFn) => {
  if (audio.codec === "copy") return t("presets.audioCopy");

  const bitrateValue = typeof audio.bitrate === "number" && audio.bitrate > 0 ? audio.bitrate : null;

  if (audio.codec === "aac") {
    const profile = audio.loudnessProfile;
    if (bitrateValue != null) {
      if (profile === "ebuR128") {
        return t("presets.audioAacLoudnormEbu", { kbps: bitrateValue });
      }
      if (profile === "cnBroadcast") {
        return t("presets.audioAacLoudnormCn", { kbps: bitrateValue });
      }
      return t("presets.audioAac", { kbps: bitrateValue });
    }
    return "AAC";
  }

  const name = String(audio.codec).toUpperCase();
  return bitrateValue != null ? `${name} ${bitrateValue}k` : name;
};
