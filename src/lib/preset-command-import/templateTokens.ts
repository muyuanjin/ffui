import { splitCommandLine, stripQuotes, wrapWithSameQuotes } from "./utils";

const normalizeProgramToken = (token: string): string => {
  const unquoted = stripQuotes(token);
  const lower = unquoted.toLowerCase();
  if (/(?:^|[\\/])ffmpeg(?:\\.exe)?$/.test(lower)) {
    return "ffmpeg";
  }
  return token;
};

const looksArgsOnly = (tokens: string[]): boolean => {
  if (tokens.length === 0) return false;
  const first = stripQuotes(tokens[0]);
  return first.startsWith("-");
};

const ensureProgramPrefixed = (tokens: string[]): { tokens: string[]; hadProgram: boolean } => {
  if (tokens.length === 0) return { tokens: [], hadProgram: false };
  if (looksArgsOnly(tokens)) {
    return { tokens: ["ffmpeg", ...tokens], hadProgram: false };
  }
  const first = normalizeProgramToken(tokens[0]);
  const isProgram = stripQuotes(first).toLowerCase() === "ffmpeg";
  if (isProgram) {
    const next = [...tokens];
    next[0] = "ffmpeg";
    return { tokens: next, hadProgram: true };
  }
  const normalizedFirst = normalizeProgramToken(tokens[0]);
  const normalizedFirstUnquoted = stripQuotes(normalizedFirst).toLowerCase();
  if (normalizedFirstUnquoted === "ffmpeg") {
    const next = [...tokens];
    next[0] = "ffmpeg";
    return { tokens: next, hadProgram: true };
  }
  return { tokens: ["ffmpeg", ...tokens], hadProgram: false };
};

const runtimeOnlyAllowlist = new Set(["-progress", "-nostdin", "-stats_period"]);

const lastNonRuntimeIndex = (tokens: string[]): number => {
  let i = tokens.length - 1;
  while (i >= 0) {
    const raw = stripQuotes(tokens[i]).toLowerCase();
    if (raw === "-nostdin") {
      i -= 1;
      continue;
    }
    if (raw === "pipe:2" && i > 0 && stripQuotes(tokens[i - 1]).toLowerCase() === "-progress") {
      i -= 2;
      continue;
    }
    if (i > 0 && stripQuotes(tokens[i - 1]).toLowerCase() === "-stats_period") {
      i -= 2;
      continue;
    }
    break;
  }
  return i;
};

const dropRuntimeOnlyTokens = (tokens: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const lower = stripQuotes(token).toLowerCase();
    if (runtimeOnlyAllowlist.has(lower)) {
      if (lower === "-progress" || lower === "-stats_period") {
        i += 1;
      }
      continue;
    }
    if (lower === "pipe:2" && out[out.length - 1] === "-progress") {
      continue;
    }
    out.push(token);
  }
  return out;
};

export const normalizeForComparison = (tokens: string[]): string[] => {
  const normalized: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const unquoted = stripQuotes(token);
    const lower = unquoted.toLowerCase();

    if (i === 0) {
      normalized.push("ffmpeg");
      continue;
    }

    if (lower === "input") {
      normalized.push("INPUT");
      continue;
    }
    if (lower === "output") {
      normalized.push("OUTPUT");
      continue;
    }

    normalized.push(token);
  }
  return dropRuntimeOnlyTokens(normalized);
};

const countPlaceholder = (tokens: string[], placeholder: "INPUT" | "OUTPUT"): number => {
  let count = 0;
  for (const token of tokens) {
    if (stripQuotes(token) === placeholder) count += 1;
  }
  return count;
};

const findSingleInputIndex = (tokens: string[]): { inputValueIndex: number; reason?: string } => {
  const indices: number[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (stripQuotes(tokens[i]) === "-i") {
      indices.push(i + 1);
    }
  }
  if (indices.length === 0) return { inputValueIndex: -1, reason: "缺少 -i <输入> 参数" };
  if (indices.length > 1) return { inputValueIndex: -1, reason: "包含多个 -i 输入（当前仅支持单输入）" };
  const idx = indices[0];
  const candidate = tokens[idx] ?? "";
  if (!candidate || stripQuotes(candidate).startsWith("-"))
    return { inputValueIndex: -1, reason: "无法识别 -i 后的输入参数" };
  return { inputValueIndex: idx };
};

const findSingleOutputIndex = (tokens: string[], inputValueIndex: number): { outputIndex: number; reason?: string } => {
  const lastIdx = lastNonRuntimeIndex(tokens);
  for (let i = lastIdx; i >= 0; i -= 1) {
    if (i === inputValueIndex) continue;
    const raw = tokens[i];
    const unquoted = stripQuotes(raw);
    if (!unquoted) continue;
    if (unquoted.startsWith("-")) continue;
    return { outputIndex: i };
  }
  return { outputIndex: -1, reason: "缺少输出文件参数" };
};

export const normalizeLineToTemplateTokens = (
  line: string,
): { tokensWithProgram: string[]; argsOnlyTokens: string[] | null; reasons: string[] } => {
  const segments = splitCommandLine(line);
  if (segments.length === 0) {
    return { tokensWithProgram: [], argsOnlyTokens: null, reasons: ["空行"] };
  }

  const { tokens: withProgramRaw } = ensureProgramPrefixed(segments);
  const tokensWithProgram = [...withProgramRaw];
  tokensWithProgram[0] = "ffmpeg";

  const reasons: string[] = [];

  const inputCount = countPlaceholder(tokensWithProgram, "INPUT");
  const outputCount = countPlaceholder(tokensWithProgram, "OUTPUT");

  let inputValueIndex = -1;
  let outputIndex = -1;

  if (inputCount === 1) {
    inputValueIndex = tokensWithProgram.findIndex((t) => stripQuotes(t) === "INPUT");
  }
  if (outputCount === 1) {
    outputIndex = tokensWithProgram.findIndex((t) => stripQuotes(t) === "OUTPUT");
  }

  if (inputValueIndex === -1) {
    const found = findSingleInputIndex(tokensWithProgram);
    if (found.reason) reasons.push(found.reason);
    inputValueIndex = found.inputValueIndex;
    if (inputValueIndex >= 0) {
      tokensWithProgram[inputValueIndex] = wrapWithSameQuotes(tokensWithProgram[inputValueIndex], "INPUT");
    }
  }

  if (outputIndex === -1) {
    const found = findSingleOutputIndex(tokensWithProgram, inputValueIndex);
    if (found.reason) reasons.push(found.reason);
    outputIndex = found.outputIndex;
    if (outputIndex >= 0) {
      tokensWithProgram[outputIndex] = wrapWithSameQuotes(tokensWithProgram[outputIndex], "OUTPUT");
    }
  }

  const finalInputCount = countPlaceholder(tokensWithProgram, "INPUT");
  const finalOutputCount = countPlaceholder(tokensWithProgram, "OUTPUT");

  if (finalInputCount !== 1) {
    reasons.push(finalInputCount === 0 ? "无法形成 INPUT 占位符" : "检测到多个 INPUT 占位符（当前仅支持单输入）");
  }
  if (finalOutputCount !== 1) {
    reasons.push(finalOutputCount === 0 ? "无法形成 OUTPUT 占位符" : "检测到多个 OUTPUT 占位符（当前仅支持单输出）");
  }

  if (finalInputCount !== 1 || finalOutputCount !== 1) {
    return { tokensWithProgram, argsOnlyTokens: null, reasons };
  }

  const outputPos = tokensWithProgram.findIndex((t) => stripQuotes(t) === "OUTPUT");
  if (outputPos !== lastNonRuntimeIndex(tokensWithProgram)) {
    reasons.push("OUTPUT 必须是命令的最后一个输出参数（当前仅支持单输出）");
    return { tokensWithProgram, argsOnlyTokens: null, reasons };
  }

  const argsOnlyTokens = tokensWithProgram.slice(1);
  return { tokensWithProgram, argsOnlyTokens, reasons };
};
