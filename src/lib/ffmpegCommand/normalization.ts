/**
 * FFmpeg 模板规范化模块
 *
 * 提供将原始 ffmpeg 命令字符串转换为标准模板格式的功能，
 * 将检测到的输入/输出路径替换为 INPUT/OUTPUT 占位符。
 */

export interface TemplateParseResult {
  template: string;
  inputReplaced: boolean;
  outputReplaced: boolean;
}

/**
 * 去除字符串两端的引号（双引号或单引号）
 */
const stripQuotes = (value: string): string =>
  value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

/**
 * 检测字符串是否具有输入占位符的特征
 */
const hasInputPlaceholderShape = (raw: string): boolean => {
  const lower = stripQuotes(raw).toLowerCase();
  return (
    lower.includes("input") ||
    lower.includes("infile") ||
    lower.includes("输入") ||
    lower.includes("源文件") ||
    lower.includes("原始文件")
  );
};

/**
 * 检测字符串是否具有输出占位符的特征
 */
const hasOutputPlaceholderShape = (raw: string): boolean => {
  const lower = stripQuotes(raw).toLowerCase();
  return (
    lower.includes("output") ||
    lower.includes("outfile") ||
    lower.includes("输出") ||
    lower.includes("目标文件") ||
    lower.includes("结果文件")
  );
};

/**
 * 使用与原始字符串相同的引号包裹占位符
 */
const wrapWithSameQuotes = (original: string, placeholder: string): string => {
  const match = original.match(/^(['"])(.*)\1$/);
  if (match) {
    return `${match[1]}${placeholder}${match[1]}`;
  }
  return placeholder;
};

/**
 * Normalize a raw ffmpeg command string into the template format we expect
 * in presets, replacing the detected input/output path with INPUT / OUTPUT
 * placeholders while preserving other flags.
 */
export const normalizeFfmpegTemplate = (raw: string): TemplateParseResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { template: "", inputReplaced: false, outputReplaced: false };
  }

  const segments = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  if (segments.length === 0) {
    return { template: trimmed, inputReplaced: false, outputReplaced: false };
  }

  const tokens = [...segments];

  // Normalize the program token so templates stay stable even when the
  // runtime path points to a local dev build such as
  // `E:\RustWorkSpace\ffui\src-tauri\target\debug\tools\ffmpeg.exe`.
  if (tokens.length > 0) {
    const first = tokens[0];
    const unquoted = stripQuotes(first);
    const lowerFirst = unquoted.toLowerCase();
    if (/(?:^|[\\/])ffmpeg(?:\.exe)?$/.test(lowerFirst)) {
      tokens[0] = "ffmpeg";
    } else if (/(?:^|[\\/])ffprobe(?:\.exe)?$/.test(lowerFirst)) {
      tokens[0] = "ffprobe";
    }
  }

  let inputIndex = -1;
  let outputIndex = -1;

  // 1) Prefer explicit `-i <path>` style for input.
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (token === "-i" || token === "-input") {
      const candidate = tokens[i + 1];
      if (candidate && !candidate.startsWith("-")) {
        inputIndex = i + 1;
        break;
      }
    }
  }

  // 2) Fallback: first placeholder-shaped token as input.
  if (inputIndex === -1) {
    inputIndex = tokens.findIndex((t) => hasInputPlaceholderShape(t));
  }

  if (inputIndex >= 0) {
    tokens[inputIndex] = wrapWithSameQuotes(tokens[inputIndex], "INPUT");
  }

  // 3) Output: prefer explicit placeholder-shaped token.
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (i === inputIndex) continue;
    const token = tokens[i];
    if (hasOutputPlaceholderShape(token)) {
      outputIndex = i;
      break;
    }
  }

  // 4) Fallback: last non-option, non-program token as output.
  if (outputIndex === -1) {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (i === inputIndex) continue;
      const token = tokens[i];
      if (token.startsWith("-")) continue;
      const lower = stripQuotes(token).toLowerCase();
      if (lower === "ffmpeg" || lower === "ffprobe") continue;
      outputIndex = i;
      break;
    }
  }

  if (outputIndex >= 0) {
    tokens[outputIndex] = wrapWithSameQuotes(tokens[outputIndex], "OUTPUT");
  }

  return {
    template: tokens.join(" "),
    inputReplaced: inputIndex >= 0,
    outputReplaced: outputIndex >= 0,
  };
};
