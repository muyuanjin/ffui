import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";

export const applyMappingToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-map") {
    const v = readValue(tokens, i, "-map", state.reasons);
    if (!v) return { consumed: 0 };
    state.maps.push(stripQuotes(v));
    state.sawMap = true;
    return { consumed: 1 };
  }
  if (token === "-map_metadata") {
    const v = readValue(tokens, i, "-map_metadata", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    const idx = Number(raw);
    if (!Number.isInteger(idx)) {
      state.reasons.push(`暂不支持复杂 -map_metadata 形式：${raw}`);
      return { consumed: 0, stop: true };
    }
    state.mapping.mapMetadataFromInputFileIndex = idx;
    return { consumed: 1 };
  }
  if (token === "-map_chapters") {
    const v = readValue(tokens, i, "-map_chapters", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    const idx = Number(raw);
    if (!Number.isInteger(idx)) {
      state.reasons.push(`不支持的 -map_chapters 输入索引：${raw}`);
      return { consumed: 0, stop: true };
    }
    state.mapping.mapChaptersFromInputFileIndex = idx;
    return { consumed: 1 };
  }
  if (token === "-metadata") {
    const v = readValue(tokens, i, "-metadata", state.reasons);
    if (!v) return { consumed: 0 };
    state.metadata.push(stripQuotes(v));
    return { consumed: 1 };
  }
  if (token === "-disposition") {
    const v = readValue(tokens, i, "-disposition", state.reasons);
    if (!v) return { consumed: 0 };
    state.dispositions.push(stripQuotes(v));
    return { consumed: 1 };
  }

  return null;
};
