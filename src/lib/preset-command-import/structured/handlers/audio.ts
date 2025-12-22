import type { AudioCodecType } from "@/types";
import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";
import { parseAudioCodecType } from "../codecs";

export const applyAudioToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-c:a") {
    const v = readValue(tokens, i, "-c:a", state.reasons);
    if (!v) return { consumed: 0 };
    const codec = parseAudioCodecType(v);
    if (!codec) {
      state.reasons.push(`不支持的音频编码器：${stripQuotes(v)}`);
      return { consumed: 0, stop: true };
    }
    state.audio.codec = codec as AudioCodecType;
    return { consumed: 1 };
  }
  if (token === "-b:a") {
    const v = readValue(tokens, i, "-b:a", state.reasons);
    if (!v) return { consumed: 0 };
    const numeric = Number(stripQuotes(v).replace(/k$/i, ""));
    if (Number.isFinite(numeric)) state.audio.bitrate = numeric;
    return { consumed: 1 };
  }
  if (token === "-ar") {
    const v = readValue(tokens, i, "-ar", state.reasons);
    if (!v) return { consumed: 0 };
    const numeric = Number(stripQuotes(v));
    if (Number.isFinite(numeric)) state.audio.sampleRateHz = numeric;
    return { consumed: 1 };
  }
  if (token === "-ac") {
    const v = readValue(tokens, i, "-ac", state.reasons);
    if (!v) return { consumed: 0 };
    const numeric = Number(stripQuotes(v));
    if (Number.isFinite(numeric)) state.audio.channels = numeric;
    return { consumed: 1 };
  }
  if (token === "-channel_layout") {
    const v = readValue(tokens, i, "-channel_layout", state.reasons);
    if (!v) return { consumed: 0 };
    state.audio.channelLayout = stripQuotes(v);
    return { consumed: 1 };
  }

  return null;
};
