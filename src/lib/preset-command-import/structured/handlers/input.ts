import { stripQuotes } from "../../utils";
import type { StructuredParseState, TokenHandlerResult } from "../state";
import { readValue } from "../readValue";

export const applyInputToken = (
  state: StructuredParseState,
  tokens: string[],
  i: number,
): TokenHandlerResult | null => {
  const token = stripQuotes(tokens[i]);

  if (token === "-ss") {
    const v = readValue(tokens, i, "-ss", state.reasons);
    if (!v) return { consumed: 0 };
    state.input.seekPosition = stripQuotes(v);
    state.input.seekMode = state.beforeInput ? "input" : "output";
    return { consumed: 1 };
  }
  if (token === "-accurate_seek") {
    state.input.accurateSeek = true;
    return { consumed: 0 };
  }
  if (token === "-stream_loop") {
    if (!state.beforeInput) {
      state.reasons.push("-stream_loop 必须出现在 -i INPUT 之前");
      return { consumed: 0, stop: true };
    }
    const v = readValue(tokens, i, "-stream_loop", state.reasons);
    if (!v) return { consumed: 0 };
    const raw = stripQuotes(v);
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      state.reasons.push(`不支持的 -stream_loop 值：${raw}`);
      return { consumed: 0, stop: true };
    }
    state.input.streamLoop = n;
    return { consumed: 1 };
  }
  if (token === "-itsoffset") {
    if (!state.beforeInput) {
      state.reasons.push("-itsoffset 必须出现在 -i INPUT 之前");
      return { consumed: 0, stop: true };
    }
    const v = readValue(tokens, i, "-itsoffset", state.reasons);
    if (!v) return { consumed: 0 };
    state.input.inputTimeOffset = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-t") {
    const v = readValue(tokens, i, "-t", state.reasons);
    if (!v) return { consumed: 0 };
    state.input.durationMode = "duration";
    state.input.duration = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-to") {
    const v = readValue(tokens, i, "-to", state.reasons);
    if (!v) return { consumed: 0 };
    state.input.durationMode = "to";
    state.input.duration = stripQuotes(v);
    return { consumed: 1 };
  }
  if (token === "-i") {
    const v = readValue(tokens, i, "-i", state.reasons);
    if (!v) return { consumed: 0, stop: true };
    const raw = stripQuotes(v);
    if (raw !== "INPUT") {
      state.reasons.push("结构化导入要求 INPUT/OUTPUT 占位符已规范化");
      return { consumed: 0, stop: true };
    }
    state.sawInput = true;
    state.beforeInput = false;
    return { consumed: 1 };
  }

  return null;
};
