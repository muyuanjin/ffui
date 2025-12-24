import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";

export const applyFiltersToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-vf") {
    const v = readValue(tokens, i, "-vf", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const vfChainParts: string[] = [];
    for (const part of parts) {
      if (part.startsWith("scale=")) {
        state.filters.scale = part.slice("scale=".length);
        continue;
      }
      if (part.startsWith("crop=")) {
        state.filters.crop = part.slice("crop=".length);
        continue;
      }
      if (part.startsWith("fps=")) {
        const fpsNum = Number(part.slice("fps=".length));
        if (Number.isFinite(fpsNum)) state.filters.fps = fpsNum;
        continue;
      }
      if (part.startsWith("subtitles=")) {
        state.filters.__burnInFilter = part;
        continue;
      }
      vfChainParts.push(part);
    }
    if (vfChainParts.length > 0) {
      state.filters.vfChain = vfChainParts.join(",");
    }
    return { consumed: 1 };
  }

  if (token === "-af") {
    state.reasons.push("结构化导入暂不支持 -af（请使用“自定义命令预设”导入）");
    return { consumed: 0, stop: true };
  }
  if (token === "-filter_complex") {
    const v = readValue(tokens, i, "-filter_complex", state.reasons);
    if (!v) return { consumed: 0 };
    state.filters.filterComplex = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-sn") {
    state.filters.__subtitleDrop = true;
    return { consumed: 0 };
  }

  return null;
};
