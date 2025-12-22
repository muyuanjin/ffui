import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";

export const applyGlobalToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-y") {
    state.global.overwriteBehavior = "overwrite";
    return { consumed: 0 };
  }
  if (token === "-n") {
    state.global.overwriteBehavior = "noOverwrite";
    return { consumed: 0 };
  }
  if (token === "-loglevel") {
    const v = readValue(tokens, i, "-loglevel", state.reasons);
    if (!v) return { consumed: 0 };
    state.global.logLevel = stripQuotes(v) as any;
    return { consumed: 1 };
  }
  if (token === "-hide_banner") {
    state.global.hideBanner = true;
    return { consumed: 0 };
  }
  if (token === "-report") {
    state.global.enableReport = true;
    return { consumed: 0 };
  }

  return null;
};
