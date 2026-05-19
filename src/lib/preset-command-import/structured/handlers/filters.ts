import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";
import { parseFpsExpression } from "@/lib/fpsExpression";
import { splitFfmpegFilterChain, stripFilterValueOuterQuotes } from "../../filterChain";

export const applyFiltersToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-vf" || token === "-filter:v") {
    const v = readValue(tokens, i, token, state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripFilterValueOuterQuotes(v);
    const parts = splitFfmpegFilterChain(raw).filter((p) => p.trim().length > 0);
    const vfChainParts: string[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith("scale=")) {
        state.filters.scale = trimmed.slice("scale=".length);
        continue;
      }
      if (trimmed.startsWith("crop=")) {
        state.filters.crop = trimmed.slice("crop=".length);
        continue;
      }
      if (trimmed.startsWith("fps=")) {
        const fpsExpr = trimmed.slice("fps=".length);
        const parsed = parseFpsExpression(fpsExpr);
        if (parsed.ok) {
          state.filters.fps = parsed.expression.value;
          continue;
        }
        vfChainParts.push(trimmed);
        continue;
      }
      if (trimmed.startsWith("subtitles=")) {
        state.filters.__burnInFilter = trimmed;
        continue;
      }
      vfChainParts.push(trimmed);
    }
    if (vfChainParts.length > 0) {
      state.filters.vfChain = vfChainParts.join(",");
    }
    return { consumed: 1 };
  }

  if (token === "-af" || token === "-filter:a") {
    const v = readValue(tokens, i, token, state.reasons);
    if (!v) return { consumed: 0 };
    state.filters.afChain = stripQuotes(v);
    return { consumed: 1 };
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
