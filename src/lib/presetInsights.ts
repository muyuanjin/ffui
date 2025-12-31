import type { FFmpegPreset } from "@/types";
import { getPresetAvgRatio, getPresetAvgSpeed } from "@/lib/presetSorter";

/** 雷达图各维度评分，统一使用 0–5 区间，数值越高表示越“好”或越强。 */
export interface PresetRadar {
  /** 主观画质（越高越接近原片或视觉无损） */
  quality: number;
  /** 体积压缩能力（越高越省空间） */
  sizeSaving: number;
  /** 编码速度（越高越快） */
  speed: number;
  /** 播放兼容性（越高越不挑设备/播放器） */
  compatibility: number;
  /** 受欢迎程度（基于历史使用次数） */
  popularity: number;
}

export type PresetScenario =
  | "share" // 分享 / 上传
  | "daily" // 日常观看 / 轻度压制
  | "archive" // 长期归档
  | "lossless" // 视觉无损 / 几乎无损
  | "copyOnly" // 仅封装 / 直拷贝
  | "audioOnly" // 仅做音频标准化
  | "experimental"; // 实验性 / 高阶玩法

export type PresetEncoderFamily =
  | "cpu-x264"
  | "cpu-x265"
  | "cpu-av1"
  | "nvenc-h264"
  | "nvenc-hevc"
  | "nvenc-av1"
  | "qsv"
  | "amf"
  | "copy"
  | "other";

export interface PresetInsights {
  /** 雷达图数值 */
  radar: PresetRadar;
  /** 是否有真实统计数据参与计算（ratio / speed / usageCount） */
  hasStats: boolean;
  /** 该预设在典型二压场景下是否有较大概率“比原片更大” */
  mayIncreaseSize: boolean;
  /** 按用途分类的场景标签，用于展示简要推荐语 */
  scenario: PresetScenario;
  /** 按编码器归类的族群标签，用于展示“CPU / NVIDIA / Intel / AMD”等提示 */
  encoderFamily: PresetEncoderFamily;
  /** 是否适合作为新手/默认预设（true 表示更安全、更通用） */
  isBeginnerFriendly: boolean;
}

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

export const computePresetRadarHeuristic = (preset: FFmpegPreset): PresetRadar => {
  const radarQuality = computeQualityScore(preset);
  const { score: radarSizeSaving } = computeSizeSavingScore(preset, null);
  const radarSpeed = computeSpeedScore(preset, null);
  const radarCompatibility = computeCompatibilityScore(preset);
  const radarPopularity = computePopularityScore(preset);
  return {
    quality: radarQuality,
    sizeSaving: radarSizeSaving,
    speed: radarSpeed,
    compatibility: radarCompatibility,
    popularity: radarPopularity,
  };
};

const encoderFamilyOf = (preset: FFmpegPreset): PresetEncoderFamily => {
  const enc = String(preset.video?.encoder ?? "").toLowerCase();
  if (enc === "copy") return "copy";
  // 优先识别 NVENC，以免 h264_nvenc 这类编码器被误归类为 CPU x264
  if (enc.includes("nvenc")) {
    if (enc.includes("av1")) return "nvenc-av1";
    if (enc.includes("hevc") || enc.includes("265")) return "nvenc-hevc";
    if (enc.includes("h264") || enc.includes("avc")) return "nvenc-h264";
  }
  if (enc.includes("libx264") || enc.includes("h264") || enc.includes("avc")) return "cpu-x264";
  if (enc.includes("libx265") || enc.includes("hevc") || enc.includes("h265")) {
    if (enc.includes("qsv")) return "qsv";
    if (enc.includes("amf")) return "amf";
    return "cpu-x265";
  }
  if (enc.includes("av1")) {
    if (enc.includes("qsv")) return "qsv";
    if (enc.includes("amf")) return "amf";
    if (enc.includes("libsvt")) return "cpu-av1";
    return "cpu-av1";
  }
  if (enc.includes("qsv")) return "qsv";
  if (enc.includes("amf")) return "amf";
  return "other";
};

const inferScenario = (preset: FFmpegPreset): PresetScenario => {
  const enc = String(preset.video?.encoder ?? "").toLowerCase();
  const rc = preset.video?.rateControl ?? "crf";
  const q = preset.video?.qualityValue ?? 0;
  const text = `${preset.id} ${preset.name} ${preset.description ?? ""}`.toLowerCase();

  if (enc === "copy" && preset.audio?.codec === "copy") {
    return "copyOnly";
  }
  if (enc === "copy" && preset.audio?.codec === "aac") {
    return "audioOnly";
  }

  // 文本优先：包含“归档/archival”等关键词的直接视为归档类
  if (text.includes("archive") || text.includes("archival") || text.includes("归档")) {
    // 带有 constqp 或极低 CRF 的归档预设视为“视觉无损”
    if ((rc === "constqp" && q <= 20) || (rc === "crf" && q <= 18)) {
      return "lossless";
    }
    return "archive";
  }

  // 文本中明确提到 share/fast/分享，视为分享/日常类型
  if (text.includes("share") || text.includes("fast") || text.includes("quick") || text.includes("分享")) {
    return "share";
  }

  // 极低量化参数通常意味着“接近无损”
  if (rc === "constqp" && q <= 20) return "lossless";
  if (rc === "crf" && q <= 18) return "lossless";
  if (rc === "cq" && q <= 20) return "lossless";

  // 高压缩 AV1 / x265 且描述中没有归档关键词，默认视为日常/体积优先
  const family = encoderFamilyOf(preset);
  if (family === "cpu-av1" || family === "nvenc-av1" || family === "cpu-x265" || family === "nvenc-hevc") {
    if (rc === "crf" && q >= 30) return "share";
    if (rc === "cq" && q >= 32) return "share";
  }

  // QSV / AMF / CPU AV1 家族通常属于高阶/特定硬件玩法，默认视为实验性场景
  if (family === "qsv" || family === "amf" || family === "cpu-av1") {
    return "experimental";
  }

  return "daily";
};

const inferBeginnerFriendly = (preset: FFmpegPreset, scenario: PresetScenario, mayIncreaseSize: boolean): boolean => {
  const family = encoderFamilyOf(preset);
  const rc = preset.video?.rateControl ?? "crf";
  const q = preset.video?.qualityValue ?? 0;

  // 高阶/实验：AV1 CPU、AMF、QSV、constqp 视觉无损档、启用高级模板
  if (family === "cpu-av1" || family === "amf" || family === "qsv") return false;
  if (rc === "constqp" && q <= 22) return false;
  if (preset.advancedEnabled) return false;

  // 仅音频标准化和纯封装是相对安全的
  if (scenario === "copyOnly" || scenario === "audioOnly") return true;

  // 典型分享/日常预设，同时不会显著放大体积，视为对新手友好
  if ((scenario === "share" || scenario === "daily") && !mayIncreaseSize) {
    return true;
  }

  // 归档/视觉无损预设默认不推荐新手随手使用
  if (scenario === "archive" || scenario === "lossless") return false;

  return false;
};

const computeQualityScore = (preset: FFmpegPreset): number => {
  const family = encoderFamilyOf(preset);
  const rc = preset.video?.rateControl ?? "crf";
  const q = preset.video?.qualityValue ?? 0;
  const pixFmt = String(preset.video?.pixFmt ?? "").toLowerCase();
  const is10bit = pixFmt.includes("10");

  let score = 3;

  if (family === "cpu-x264" || family === "nvenc-h264") {
    if (rc === "crf") {
      if (q <= 18) score = 5;
      else if (q <= 22) score = 4;
      else if (q <= 24) score = 3.5;
      else if (q <= 28) score = 3;
      else score = 2;
    } else if (rc === "cq" || rc === "constqp") {
      if (q <= 20) score = 4.5;
      else if (q <= 24) score = 4;
      else if (q <= 30) score = 3.5;
      else score = 2.5;
    }
  } else if (family === "cpu-x265" || family === "nvenc-hevc") {
    if (rc === "crf") {
      if (q <= 18) score = 5;
      else if (q <= 22) score = 4.5;
      else if (q <= 26) score = 4;
      else score = 3;
    } else if (rc === "cq" || rc === "constqp") {
      if (q <= 20) score = 5;
      else if (q <= 24) score = 4.5;
      else if (q <= 28) score = 4;
      else score = 3;
    }
  } else if (family === "cpu-av1" || family === "nvenc-av1") {
    if (rc === "crf") {
      if (q <= 24) score = 4.5;
      else if (q <= 30) score = 4;
      else if (q <= 36) score = 3.5;
      else score = 3;
    } else if (rc === "cq" || rc === "constqp") {
      if (q <= 20) score = 5;
      else if (q <= 28) score = 4.5;
      else if (q <= 36) score = 4;
      else score = 3;
    }
  }

  if (is10bit) {
    score += 0.3;
  }

  return clamp(score, 1, 5);
};

const computeSizeSavingScore = (
  preset: FFmpegPreset,
  ratio: number | null,
): { score: number; mayIncreaseSize: boolean } => {
  // 若有真实统计数据，优先使用：ratio = 输出 / 输入 * 100，越小越省空间
  if (ratio != null) {
    let score: number;
    if (ratio <= 40) score = 5;
    else if (ratio <= 60) score = 4.5;
    else if (ratio <= 80) score = 4;
    else if (ratio <= 100) score = 3;
    else if (ratio <= 120) score = 2;
    else score = 1;
    const mayIncrease = ratio > 110;
    return { score: clamp(score, 1, 5), mayIncreaseSize: mayIncrease };
  }

  const family = encoderFamilyOf(preset);
  const rc = preset.video?.rateControl ?? "crf";
  const q = preset.video?.qualityValue ?? 0;

  // 无统计数据时的经验规则：先按编码器压缩能力给基准，再按质量值微调
  let base = 3;
  if (family === "cpu-av1" || family === "nvenc-av1") base = 4;
  else if (family === "cpu-x265" || family === "nvenc-hevc") base = 3.5;
  else if (family === "cpu-x264" || family === "nvenc-h264") base = 3;
  else if (family === "copy") base = 1;

  // 质量越高（q 越小）体积越大，压缩率评分应下降；反之略微升高
  let score = base;
  if (rc === "crf" || rc === "cq" || rc === "constqp") {
    if (q <= 18) score -= 1.2;
    else if (q <= 22) score -= 0.6;
    else if (q >= 36) score += 0.6;
    else if (q >= 30) score += 0.3;
  }

  const mayIncrease = (rc === "constqp" && q <= 22) || (rc === "crf" && q <= 18) || (rc === "cq" && q <= 20);

  // 对“极可能放大体积”的预设，体积压缩评分上限收紧到 2，避免给用户造成“很省空间”的错觉
  if (mayIncrease && score > 2) {
    score = 2;
  }

  return { score: clamp(score, 1, 5), mayIncreaseSize: mayIncrease };
};

const computeSpeedScore = (preset: FFmpegPreset, speedMbPerSec: number | null): number => {
  if (speedMbPerSec != null && speedMbPerSec > 0) {
    if (speedMbPerSec >= 80) return 5;
    if (speedMbPerSec >= 40) return 4;
    if (speedMbPerSec >= 15) return 3;
    if (speedMbPerSec >= 5) return 2;
    return 1;
  }

  const family = encoderFamilyOf(preset);
  const presetName = String(preset.video?.preset ?? "").toLowerCase();

  // 无统计数据时根据编码器和 preset 粗略估算速度
  if (family === "copy") return 5;
  if (family === "nvenc-h264" || family === "nvenc-hevc" || family === "nvenc-av1") {
    const match = presetName.match(/\bp([1-7])\b/);
    if (match) {
      const p = Number(match[1]);
      if (p === 1) return 5;
      if (p === 2) return 4.5;
      if (p === 3) return 4;
      if (p === 4) return 3.5;
      if (p === 5) return 3;
      if (p === 6) return 2.5;
      if (p === 7) return 2;
    }
    return 3.5;
  }
  if (family === "qsv" || family === "amf") {
    return 4;
  }

  if (family === "cpu-x264") {
    if (presetName.includes("ultrafast") || presetName.includes("superfast")) return 5;
    if (presetName.includes("veryfast") || presetName.includes("faster")) return 4;
    if (presetName.includes("medium") || presetName.includes("fast")) return 3;
    if (presetName.includes("slow")) return 2;
    return 3;
  }

  if (family === "cpu-x265" || family === "cpu-av1") {
    if (presetName.includes("0") || presetName.includes("1")) return 1;
    if (presetName.includes("2") || presetName.includes("3")) return 1.5;
    if (presetName.includes("4") || presetName.includes("5")) return 2;
    if (presetName.includes("6") || presetName.includes("7")) return 2.5;
    return 2;
  }

  return 3;
};

const computeCompatibilityScore = (preset: FFmpegPreset): number => {
  const family = encoderFamilyOf(preset);
  const pixFmt = String(preset.video?.pixFmt ?? "").toLowerCase();
  const is10bit = pixFmt.includes("10");

  let score = 3;
  if (family === "cpu-x264" || family === "nvenc-h264") {
    score = 5;
  } else if (family === "cpu-x265" || family === "nvenc-hevc") {
    score = 4;
  } else if (family === "cpu-av1" || family === "nvenc-av1") {
    score = 3;
  } else if (family === "copy") {
    score = 4.5;
  }

  if (is10bit && score >= 4) {
    // 10bit 在旧设备/老电视上兼容性稍差
    score -= 0.5;
  }

  return clamp(score, 1, 5);
};

const computePopularityScore = (preset: FFmpegPreset): number => {
  const usage = preset.stats?.usageCount ?? 0;
  if (usage <= 0) return 0;
  if (usage >= 100) return 5;
  if (usage >= 50) return 4;
  if (usage >= 20) return 3;
  if (usage >= 5) return 2;
  return 1;
};

/**
 * 计算单个预设的综合洞察数据：
 * - 有真实统计时优先使用统计数据反映体积/速度；
 * - 无统计时用规则估算，保证新预设也有可视化参考。
 */
export const computePresetInsights = (preset: FFmpegPreset): PresetInsights => {
  const ratio = getPresetAvgRatio(preset);
  const speed = getPresetAvgSpeed(preset);
  const radarQuality = computeQualityScore(preset);
  const { score: radarSizeSaving, mayIncreaseSize: sizeMayIncrease } = computeSizeSavingScore(preset, ratio);
  const radarSpeed = computeSpeedScore(preset, speed);
  const radarCompatibility = computeCompatibilityScore(preset);
  const radarPopularity = computePopularityScore(preset);

  const scenario = inferScenario(preset);
  const encoderFamily = encoderFamilyOf(preset);

  // 如果统计显示明显放大体积，覆盖规则推测
  const mayIncreaseSize = sizeMayIncrease || (ratio != null && ratio > 110);

  const isBeginnerFriendly = inferBeginnerFriendly(preset, scenario, mayIncreaseSize);

  return {
    radar: {
      quality: radarQuality,
      sizeSaving: radarSizeSaving,
      speed: radarSpeed,
      compatibility: radarCompatibility,
      popularity: radarPopularity,
    },
    hasStats:
      ratio != null ||
      speed != null ||
      (preset.stats && Number.isFinite(preset.stats.totalInputSizeMB) && preset.stats.totalInputSizeMB > 0),
    mayIncreaseSize,
    scenario,
    encoderFamily,
    isBeginnerFriendly,
  };
};
