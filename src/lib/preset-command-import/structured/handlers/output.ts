import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";

export const applyOutputToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);
  if (token !== "OUTPUT") return null;
  if (i !== tokens.length - 1) {
    state.reasons.push("OUTPUT 必须是命令的最后一个参数（当前仅支持单输出）");
    return { consumed: 0, stop: true };
  }
  return { consumed: 0 };
};
