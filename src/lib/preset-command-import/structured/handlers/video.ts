import type { RateControlMode } from "@/types";
import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";
import { parseEncoderType } from "../codecs";

export const applyVideoToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-c:v") {
    const v = readValue(tokens, i, "-c:v", state.reasons);
    if (!v) return { consumed: 0 };
    const enc = parseEncoderType(v);
    if (!enc) {
      state.reasons.push(`不支持的视频编码器：${stripQuotes(v)}`);
      return { consumed: 0, stop: true };
    }
    state.video.encoder = enc;
    return { consumed: 1 };
  }
  if (token === "-crf") {
    const v = readValue(tokens, i, "-crf", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.rateControl = "crf";
    state.video.qualityValue = Number(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-cq") {
    const v = readValue(tokens, i, "-cq", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.rateControl = "cq";
    state.video.qualityValue = Number(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-rc") {
    const v = readValue(tokens, i, "-rc", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    if (raw !== "constqp") {
      state.reasons.push(`不支持的 -rc 模式：${raw}`);
      return { consumed: 0, stop: true };
    }
    state.video.rateControl = "constqp";
    return { consumed: 1 };
  }
  if (token === "-qp") {
    const v = readValue(tokens, i, "-qp", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.qualityValue = Number(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-b:v") {
    const v = readValue(tokens, i, "-b:v", state.reasons);
    if (!v) return { consumed: 0 };
    const numeric = Number(stripQuotes(v).replace(/k$/i, ""));
    if (Number.isFinite(numeric)) {
      state.video.bitrateKbps = numeric;
      if (!state.video.rateControl) state.video.rateControl = "cbr" as RateControlMode;
    }
    return { consumed: 1 };
  }
  if (token === "-maxrate") {
    const v = readValue(tokens, i, "-maxrate", state.reasons);
    if (!v) return { consumed: 0 };
    const numeric = Number(stripQuotes(v).replace(/k$/i, ""));
    if (Number.isFinite(numeric)) {
      state.video.maxBitrateKbps = numeric;
      state.video.rateControl = "vbr";
    }
    return { consumed: 1 };
  }
  if (token === "-bufsize") {
    const v = readValue(tokens, i, "-bufsize", state.reasons);
    if (!v) return { consumed: 0 };
    const numeric = Number(stripQuotes(v).replace(/k$/i, ""));
    if (Number.isFinite(numeric)) {
      state.video.bufferSizeKbits = numeric;
      if (!state.video.rateControl) state.video.rateControl = "vbr";
    }
    return { consumed: 1 };
  }
  if (token === "-passlogfile" || token.startsWith("-passlogfile:")) {
    const v = readValue(tokens, i, token, state.reasons);
    if (!v) return { consumed: 0 };
    const prefix = stripQuotes(v).trim();
    if (prefix !== "OUTPUT.ffui2pass") {
      state.reasons.push("结构化模式不支持自定义 -passlogfile（FFUI 会自动生成以避免冲突）");
      return { consumed: 0, stop: true };
    }
    return { consumed: 1 };
  }
  if (token === "-pass") {
    const v = readValue(tokens, i, "-pass", state.reasons);
    if (!v) return { consumed: 0 };
    const pass = Number(stripQuotes(v));
    if (pass === 1 || pass === 2) state.video.pass = 2;
    return { consumed: 1 };
  }
  if (token === "-preset") {
    const v = readValue(tokens, i, "-preset", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.preset = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-tune") {
    const v = readValue(tokens, i, "-tune", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.tune = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-profile:v") {
    const v = readValue(tokens, i, "-profile:v", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.profile = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-level") {
    const v = readValue(tokens, i, "-level", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.level = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-g") {
    const v = readValue(tokens, i, "-g", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.gopSize = Number(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-bf") {
    const v = readValue(tokens, i, "-bf", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.bf = Number(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-pix_fmt") {
    const v = readValue(tokens, i, "-pix_fmt", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.pixFmt = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-b_ref_mode") {
    const v = readValue(tokens, i, "-b_ref_mode", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.bRefMode = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-rc-lookahead") {
    const v = readValue(tokens, i, "-rc-lookahead", state.reasons);
    if (!v) return { consumed: 0 };
    state.video.rcLookahead = Number(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-spatial-aq") {
    const v = readValue(tokens, i, "-spatial-aq", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    if (raw !== "1") {
      state.reasons.push("仅支持 -spatial-aq 1（FFUI 结构化模式不输出 0）");
      return { consumed: 0, stop: true };
    }
    state.video.spatialAq = true;
    return { consumed: 1 };
  }
  if (token === "-temporal-aq") {
    const v = readValue(tokens, i, "-temporal-aq", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    if (raw !== "1") {
      state.reasons.push("仅支持 -temporal-aq 1（FFUI 结构化模式不输出 0）");
      return { consumed: 0, stop: true };
    }
    state.video.temporalAq = true;
    return { consumed: 1 };
  }

  return null;
};
