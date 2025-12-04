import type { AudioConfig, FilterConfig, FFmpegPreset, VideoConfig } from "@/types";

export type CommandTokenKind =
  | "program"
  | "option"
  | "path"
  | "encoder"
  | "placeholder"
  | "other"
  | "whitespace";

export interface CommandToken {
  text: string;
  kind: CommandTokenKind;
}

export interface TemplateParseResult {
  template: string;
  inputReplaced: boolean;
  outputReplaced: boolean;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripQuotes = (value: string): string =>
  value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

const classifyCommandToken = (segment: string, index: number): CommandTokenKind => {
  if (!segment.trim()) return "whitespace";

  const unquoted = stripQuotes(segment);
  const lower = unquoted.toLowerCase();

  if (unquoted === "INPUT" || unquoted === "OUTPUT") {
    return "placeholder";
  }

  if (index === 0 && (lower === "ffmpeg" || lower === "ffprobe")) {
    return "program";
  }

  if (unquoted.startsWith("-")) {
    return "option";
  }

  if (/[\\/]/.test(unquoted) || /\.(mp4|mkv|mov|avi|webm|m4v|m4a|mp3)$/i.test(unquoted)) {
    return "path";
  }

  if (/libx264|libx265|hevc_nvenc|h264_nvenc|libsvtav1|av1/i.test(lower)) {
    return "encoder";
  }

  return "other";
};

export const tokenizeFfmpegCommand = (
  command: string | undefined | null,
): CommandToken[] => {
  const raw = command ?? "";
  if (!raw) return [];

  const tokens: CommandToken[] = [];
  const regex = /(".*?"|'.*?'|\S+)/g;
  let lastIndex = 0;
  let logicalIndex = 0;

  let match: RegExpExecArray | null;
  // Walk through the command, preserving all whitespace segments so that
  // joining token.text later reconstructs the exact original string.
  while ((match = regex.exec(raw)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      tokens.push({ text: raw.slice(lastIndex, start), kind: "whitespace" });
    }
    const segment = match[0];
    tokens.push({
      text: segment,
      kind: classifyCommandToken(segment, logicalIndex),
    });
    lastIndex = start + segment.length;
    logicalIndex += 1;
  }

  if (lastIndex < raw.length) {
    tokens.push({ text: raw.slice(lastIndex), kind: "whitespace" });
  }

  return tokens;
};

const commandTokenClass = (kind: CommandTokenKind): string => {
  switch (kind) {
    case "program":
      return "text-emerald-400";
    case "option":
      return "text-blue-400";
    case "path":
      return "text-amber-400";
    case "encoder":
      return "text-purple-300";
    case "placeholder":
      return "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded px-0.5 cursor-help";
    default:
      return "";
  }
};

const commandTokenTitle = (kind: CommandTokenKind, rawText: string): string | null => {
  if (kind === "placeholder") {
    const unquoted = stripQuotes(rawText);
    if (unquoted === "INPUT") {
      return "INPUT 占位符：执行时会替换为输入文件路径";
    }
    if (unquoted === "OUTPUT") {
      return "OUTPUT 占位符：执行时会替换为输出文件路径";
    }
  }
  return null;
};

export const highlightFfmpegCommand = (
  command: string | undefined | null,
): string => {
  const tokens = tokenizeFfmpegCommand(command);
  if (!tokens.length) return "";

  return tokens
    .map((token) => {
      const cls = commandTokenClass(token.kind);
      const escaped = escapeHtml(token.text);
      if (!cls) return escaped;
      const title = commandTokenTitle(token.kind, token.text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<span class="${cls}"${titleAttr}>${escaped}</span>`;
    })
    .join("");
};

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
  // `E:\RustWorkSpace\transcoding\src-tauri\target\debug\tools\ffmpeg.exe`.
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

export interface FfmpegCommandPreviewInput {
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  /** When true and template is non-empty, use the raw template instead of structured flags. */
  advancedEnabled?: boolean;
  /** Optional full ffmpeg command template using INPUT/OUTPUT placeholders. */
  ffmpegTemplate?: string;
}

/**
 * Build a structured ffmpeg command preview from typed preset fields.
 * This mirrors the logic used by the preset wizard and parameter panel.
 */
export const buildFfmpegCommandFromStructured = (
  input: FfmpegCommandPreviewInput,
): string => {
  const inputPlaceholder = "INPUT";
  const outputPlaceholder = "OUTPUT";

  const v = input.video as VideoConfig;
  const a = input.audio as AudioConfig;
  const f = input.filters as FilterConfig;

  const args: string[] = [];

  // input
  args.push("-i", inputPlaceholder);

  // video
  if (v.encoder === "copy") {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", v.encoder);

    // 速率控制：质量优先（CRF/CQ）与码率优先（CBR/VBR + two-pass）互斥。
    if (v.rateControl === "crf" || v.rateControl === "cq") {
      args.push(v.rateControl === "crf" ? "-crf" : "-cq", String(v.qualityValue));
    } else if (v.rateControl === "cbr" || v.rateControl === "vbr") {
      if (typeof v.bitrateKbps === "number" && v.bitrateKbps > 0) {
        args.push("-b:v", `${v.bitrateKbps}k`);
      }
      if (typeof v.maxBitrateKbps === "number" && v.maxBitrateKbps > 0) {
        args.push("-maxrate", `${v.maxBitrateKbps}k`);
      }
      if (typeof v.bufferSizeKbits === "number" && v.bufferSizeKbits > 0) {
        args.push("-bufsize", `${v.bufferSizeKbits}k`);
      }
      if (v.pass === 1 || v.pass === 2) {
        args.push("-pass", String(v.pass));
      }
    }

    if (v.preset) {
      args.push("-preset", v.preset);
    }
    if (v.tune) {
      args.push("-tune", v.tune);
    }
    if (v.profile) {
      args.push("-profile:v", v.profile);
    }
  }

  // audio
  if (a.codec === "copy") {
    args.push("-c:a", "copy");
  } else if (a.codec === "aac") {
    args.push("-c:a", "aac");
    if (a.bitrate) {
      args.push("-b:a", `${a.bitrate}k`);
    }
  }

  // filters
  const vfParts: string[] = [];
  if (f.scale) {
    vfParts.push(`scale=${f.scale}`);
  }
  if (f.crop) {
    vfParts.push(`crop=${f.crop}`);
  }
  if (typeof f.fps === "number" && f.fps > 0) {
    vfParts.push(`fps=${f.fps}`);
  }
  if (vfParts.length > 0) {
    args.push("-vf", vfParts.join(","));
  }

  // output
  args.push(outputPlaceholder);

  return ["ffmpeg", ...args].join(" ");
};

/**
 * Compute the effective ffmpeg command preview for a given preset-like input,
 * honoring advanced/template mode when enabled.
 */
export const getFfmpegCommandPreview = (
  input: FfmpegCommandPreviewInput,
): string => {
  const template = (input.ffmpegTemplate ?? "").trim();
  if (input.advancedEnabled && template.length > 0) {
    return template;
  }
  return buildFfmpegCommandFromStructured(input);
};

/**
 * Convenience helper for computing the command preview of a persisted preset.
 */
export const getPresetCommandPreview = (preset: FFmpegPreset): string =>
  getFfmpegCommandPreview({
    video: preset.video,
    audio: preset.audio,
    filters: preset.filters,
    advancedEnabled: preset.advancedEnabled,
    ffmpegTemplate: preset.ffmpegTemplate,
  });
