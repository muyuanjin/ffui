import type { CommandTokenKind } from "./tokenizer";
import { tokenizeFfmpegCommand } from "./tokenizer";
import { assignCommandTokenGroups } from "./grouping";

/**
 * Escape HTML special characters
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Strip leading and trailing quotes from a string
 */
const stripQuotes = (value: string): string => value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

/**
 * Re-wrap a replacement value with the same quote style (single/double) as
 * the original token when it was quoted.
 */
const wrapWithSameQuotes = (original: string, replacement: string): string => {
  const match = original.match(/^(['"])(.*)\1$/);
  if (match) {
    const quote = match[1];
    return `${quote}${replacement}${quote}`;
  }
  return replacement;
};

/**
 * Get CSS class for a command token kind
 */
const commandTokenClass = (kind: CommandTokenKind): string => {
  switch (kind) {
    case "program":
      // Program + path tokens can be extremely long (absolute paths). Keep the
      // underlying text intact for copy/select, but visually truncate and rely
      // on the title tooltip to reveal the full value.
      return "text-emerald-400 font-semibold inline-block max-w-[min(60vw,260px)] overflow-hidden text-ellipsis whitespace-nowrap align-bottom cursor-help";
    case "option":
      return "text-blue-400";
    case "path":
      return "text-amber-400 inline-block max-w-[min(60vw,360px)] overflow-hidden text-ellipsis whitespace-nowrap align-bottom cursor-help";
    case "encoder":
      return "text-purple-300";
    case "placeholder":
      return "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded px-0.5 cursor-help";
    default:
      return "";
  }
};

const looksLikePath = (value: string) => {
  return value.includes("/") || value.includes("\\") || value.includes(":");
};

/**
 * Get tooltip title for a command token
 */
const commandTokenTitle = (kind: CommandTokenKind, rawText: string): string | null => {
  const unquoted = stripQuotes(rawText);
  const lower = unquoted.toLowerCase();

  if (kind === "program") {
    if (lower.includes("ffmpeg")) {
      return "ffmpeg 可执行文件路径（实际调用的转码二进制）";
    }
    if (lower.includes("ffprobe")) {
      return "ffprobe 可执行文件路径（用于媒体信息探测）";
    }
  }

  if (kind === "placeholder") {
    if (unquoted === "INPUT") {
      return "INPUT 占位符：执行时会替换为输入文件路径";
    }
    if (unquoted === "OUTPUT") {
      return "OUTPUT 占位符：执行时会替换为输出文件路径";
    }
  }

  if (kind === "option") {
    if (lower === "-progress") {
      return "-progress pipe:2：强制启用结构化进度输出，队列根据它实时更新任务进度（系统自动注入，无法关闭）。";
    }
    if (lower === "-nostdin") {
      return "-nostdin：禁止从标准输入读取，防止 ffmpeg 在无人值守队列中卡在交互式提问（系统自动注入，无法关闭）。";
    }
  }

  if (kind === "other" && unquoted === "pipe:2") {
    return "pipe:2：将 -progress 的结构化进度信息写入 stderr，以便队列解析。";
  }

  return null;
};

export interface HighlightProgramOverrides {
  ffmpeg?: string | null;
  ffprobe?: string | null;
}

export interface HighlightOptions {
  /**
   * Optional overrides for the program token when it is a bare `ffmpeg` /
   * `ffprobe` name. This is used by the queue/task detail views to expand
   * the logical program into the concrete executable path that was (or will
   * be) invoked by the backend.
   */
  programOverrides?: HighlightProgramOverrides;
}

const applyProgramOverride = (
  kind: CommandTokenKind,
  rawText: string,
  overrides?: HighlightProgramOverrides,
): string | null => {
  if (kind !== "program" || !overrides) return null;

  const unquoted = stripQuotes(rawText);
  const lower = unquoted.toLowerCase();
  const base = lower.replace(/^.*[\\/]/, "");

  const isFfmpeg = base === "ffmpeg" || base === "ffmpeg.exe";
  const isFfprobe = base === "ffprobe" || base === "ffprobe.exe";

  const replacement = (isFfmpeg && overrides.ffmpeg) || (isFfprobe && overrides.ffprobe) || null;
  if (!replacement) return null;

  // Only override when the original looks like a bare program name without
  // path segments. If the backend already logged an absolute path, keep it.
  const looksLikeBareProgram = !unquoted.includes("/") && !unquoted.includes("\\") && !unquoted.includes(":");
  if (!looksLikeBareProgram) return null;

  // Quote the replacement when it contains spaces and the original token was
  // not already explicitly quoted.
  const needsQuotes = /\s/.test(replacement) && !/^['"].*['"]$/.test(rawText.trim());
  const withQuotes = needsQuotes ? `"${replacement}"` : replacement;

  return wrapWithSameQuotes(rawText, withQuotes);
};

export const applyProgramOverridesToCommand = (
  command: string | undefined | null,
  overrides?: HighlightProgramOverrides,
): string => {
  const raw = command ?? "";
  if (!raw) return "";

  // Reuse the same token classification used by highlighting so the produced
  // command string matches what the UI renders.
  const tokens = tokenizeFfmpegCommand(raw);
  if (!tokens.length) return raw;

  return tokens
    .map((token) => {
      const replacement = applyProgramOverride(token.kind, token.text, overrides);
      return replacement ?? token.text;
    })
    .join("");
};

/**
 * Highlight FFmpeg command with HTML syntax highlighting
 */
export const highlightFfmpegCommand = (command: string | undefined | null, options?: HighlightOptions): string => {
  const tokens = assignCommandTokenGroups(tokenizeFfmpegCommand(command));
  if (!tokens.length) return "";

  return tokens
    .map((token) => {
      const cls = commandTokenClass(token.kind);
      const programOverride =
        options?.programOverrides && applyProgramOverride(token.kind, token.text, options.programOverrides);
      const text = programOverride ?? token.text;
      const escaped = escapeHtml(text);
      if (!cls) return escaped;
      const unquoted = stripQuotes(text);
      let title = commandTokenTitle(token.kind, text);
      if ((token.kind === "program" || token.kind === "path") && looksLikePath(unquoted)) {
        title = title ? `${title}\n${unquoted}` : unquoted;
      }
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const groupAttr = token.group ? ` data-group="${escapeHtml(token.group)}"` : "";
      const fieldAttr = token.field ? ` data-field="${escapeHtml(token.field)}"` : "";
      return `<span class="${cls}"${titleAttr}${groupAttr}${fieldAttr}>${escaped}</span>`;
    })
    .join("");
};
