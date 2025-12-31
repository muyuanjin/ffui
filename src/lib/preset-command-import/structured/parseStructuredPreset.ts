import type { FFmpegPreset, SubtitlesConfig, VideoConfig } from "@/types";
import { buildFfmpegCommandFromStructured } from "@/lib/ffmpegCommand";
import { normalizeForComparison } from "../templateTokens";
import { splitCommandLine, stripQuotes } from "../utils";
import { isKnownOption } from "./knownOptions";
import type { StructuredParseState, TokenHandlerResult } from "./state";
import { applyGlobalToken } from "./handlers/global";
import { applyInputToken } from "./handlers/input";
import { applyMappingToken } from "./handlers/mapping";
import { applyVideoToken } from "./handlers/video";
import { applyAudioToken } from "./handlers/audio";
import { applyFiltersToken } from "./handlers/filters";
import { applyOutputToken } from "./handlers/output";

export const tryParseStructuredPreset = (tokensWithProgram: string[]): { preset?: FFmpegPreset; reasons: string[] } => {
  const reasons: string[] = [];
  const tokens = tokensWithProgram.slice(1);
  if (tokensWithProgram.length === 0) return { reasons: ["空命令"] };

  for (const token of tokens) {
    const raw = stripQuotes(token);
    const looksLikeDashedValue = /^-[0-9.]/.test(raw);
    if (raw.startsWith("-") && !looksLikeDashedValue && !isKnownOption(token)) {
      reasons.push(`不支持的参数：${raw}`);
      return { reasons };
    }
  }

  const state: StructuredParseState = {
    reasons,
    global: {},
    input: {},
    mapping: {},
    filters: {},
    video: {},
    audio: {},
    maps: [],
    metadata: [],
    dispositions: [],
    sawMap: false,
    beforeInput: true,
    sawInput: false,
  };

  const applyToken = (
    fn: (s: StructuredParseState, t: string[], i: number) => TokenHandlerResult | null,
    idx: number,
  ) => fn(state, tokens, idx);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = stripQuotes(tokens[i]);
    if (token === "-progress" || token === "-nostdin") {
      if (token === "-progress") i += 1;
      continue;
    }
    if (token === "-stats_period") {
      i += 1;
      continue;
    }

    const handlers = [
      applyGlobalToken,
      applyInputToken,
      applyMappingToken,
      applyVideoToken,
      applyAudioToken,
      applyFiltersToken,
      applyOutputToken,
    ];
    let handled: TokenHandlerResult | null = null;
    for (const fn of handlers) {
      handled = applyToken(fn, i);
      if (handled) break;
    }
    if (handled) {
      i += handled.consumed;
      if (handled.stop) return { reasons: state.reasons };
      continue;
    }

    if (!token.startsWith("-") && token !== "INPUT" && token !== "OUTPUT") {
      state.reasons.push(`无法识别的参数：${token}`);
      return { reasons: state.reasons };
    }
  }

  if (!state.sawInput) {
    state.reasons.push("缺少 INPUT 占位符");
  }
  if (!state.sawMap) {
    state.reasons.push("结构化导入要求显式 -map（例如 -map 0）");
  }
  if (!state.video.encoder) {
    state.reasons.push("缺少 -c:v <encoder>");
  }
  if (!state.audio.codec) {
    state.reasons.push("缺少 -c:a <codec>");
  }

  if (state.reasons.length > 0) return { reasons: state.reasons };

  if (state.maps.length > 0) state.mapping.maps = state.maps;
  if (state.metadata.length > 0) state.mapping.metadata = state.metadata;
  if (state.dispositions.length > 0) state.mapping.dispositions = state.dispositions;

  const videoEncoder = state.video.encoder as VideoConfig["encoder"];
  if (videoEncoder !== "copy") {
    if (!state.video.rateControl) state.reasons.push("缺少速率控制参数（例如 -crf / -cq / -rc constqp）");
    if (typeof state.video.qualityValue !== "number" || !Number.isFinite(state.video.qualityValue))
      state.reasons.push("缺少质量参数值");
    if (!state.video.preset) state.reasons.push("缺少 -preset <value>");
  } else {
    if (!state.video.rateControl) state.video.rateControl = "crf";
    if (typeof state.video.qualityValue !== "number" || !Number.isFinite(state.video.qualityValue))
      state.video.qualityValue = 23;
    if (!state.video.preset) state.video.preset = "medium";
  }

  if (state.reasons.length > 0) return { reasons: state.reasons };

  const subtitles: SubtitlesConfig = {};
  if (state.filters.__subtitleDrop) {
    subtitles.strategy = "drop";
  }
  const burnFilter = state.filters.__burnInFilter;
  if (burnFilter) {
    subtitles.strategy = "burn_in";
    subtitles.burnInFilter = burnFilter;
  }
  delete state.filters.__subtitleDrop;
  delete state.filters.__burnInFilter;

  const preset: FFmpegPreset = {
    id: "import-temp",
    name: "Imported",
    description: "",
    global: Object.keys(state.global).length > 0 ? state.global : undefined,
    input: Object.keys(state.input).length > 0 ? state.input : undefined,
    mapping: Object.keys(state.mapping).length > 0 ? state.mapping : undefined,
    video: state.video as VideoConfig,
    audio: state.audio as FFmpegPreset["audio"],
    filters: state.filters,
    subtitles: burnFilter || subtitles.strategy ? subtitles : undefined,
    stats: {
      usageCount: 0,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
    },
    advancedEnabled: false,
    ffmpegTemplate: undefined,
    isSmartPreset: false,
  };

  const canonical = buildFfmpegCommandFromStructured({
    global: preset.global,
    input: preset.input,
    mapping: preset.mapping,
    video: preset.video,
    audio: preset.audio,
    filters: preset.filters,
    subtitles: preset.subtitles,
    container: preset.container,
    hardware: preset.hardware,
    advancedEnabled: false,
    ffmpegTemplate: "",
  });
  const canonicalTokens = normalizeForComparison(splitCommandLine(canonical));
  const inputTokens = normalizeForComparison(tokensWithProgram);
  if (canonicalTokens.join(" ") !== inputTokens.join(" ")) {
    state.reasons.push("命令与 FFUI 可编辑预设的规范格式不完全一致（为保证不丢字段需要完全一致）");
    return { reasons: state.reasons };
  }

  return { preset, reasons: [] };
};
