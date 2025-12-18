export type CommandTokenKind = "program" | "option" | "path" | "encoder" | "placeholder" | "other" | "whitespace";

export interface CommandToken {
  text: string;
  kind: CommandTokenKind;
  /** High-level parameter group used for UI navigation (global/video/audio/...). */
  group?: string;
  /** Optional field identifier within the group (for future fine-grained mapping). */
  field?: string;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripQuotes = (value: string): string => value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

const classifyCommandToken = (segment: string, index: number): CommandTokenKind => {
  if (!segment.trim()) return "whitespace";

  const unquoted = stripQuotes(segment);
  const lower = unquoted.toLowerCase();

  if (unquoted === "INPUT" || unquoted === "OUTPUT") {
    return "placeholder";
  }

  // 首个 token，无论是裸 `ffmpeg`/`ffprobe` 还是带路径的 binary，都视为“程序”而不是普通路径，
  // 这样任务详情里的 ffmpeg 可执行文件会有稳定的高亮和提示。
  if (index === 0) {
    const base = lower.replace(/^.*[\\/]/, "");
    if (base === "ffmpeg" || base === "ffmpeg.exe" || base === "ffprobe" || base === "ffprobe.exe") {
      return "program";
    }
  }

  if (unquoted.startsWith("-")) {
    return "option";
  }

  if (
    /[\\/]/.test(unquoted) ||
    /\.(mp4|mkv|flv|mov|webm|wmv|avi|rmvb|ts|m2ts|mxf|3gp|m4v|m4a|mp3|aac|wav|flac|alac|aiff|ac3|ogg|opus|png|jpg|jpeg|webp|avif|bmp)$/i.test(
      unquoted,
    )
  ) {
    return "path";
  }

  if (/libx264|libx265|hevc_nvenc|h264_nvenc|libsvtav1|av1/i.test(lower)) {
    return "encoder";
  }

  return "other";
};

export const tokenizeFfmpegCommand = (command: string | undefined | null): CommandToken[] => {
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
