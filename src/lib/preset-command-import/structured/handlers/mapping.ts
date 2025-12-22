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
