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
const stripQuotes = (value: string): string =>
  value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

/**
 * Get CSS class for a command token kind
 */
const commandTokenClass = (kind: CommandTokenKind): string => {
  switch (kind) {
    case "program":
      return "text-emerald-400 font-semibold";
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

/**
 * Highlight FFmpeg command with HTML syntax highlighting
 */
export const highlightFfmpegCommand = (
  command: string | undefined | null,
): string => {
  const tokens = assignCommandTokenGroups(tokenizeFfmpegCommand(command));
  if (!tokens.length) return "";

  return tokens
    .map((token) => {
      const cls = commandTokenClass(token.kind);
      const escaped = escapeHtml(token.text);
      if (!cls) return escaped;
      const title = commandTokenTitle(token.kind, token.text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const groupAttr = token.group ? ` data-group="${escapeHtml(token.group)}"` : "";
      const fieldAttr = token.field ? ` data-field="${escapeHtml(token.field)}"` : "";
      return `<span class="${cls}"${titleAttr}${groupAttr}${fieldAttr}>${escaped}</span>`;
    })
    .join("");
};
