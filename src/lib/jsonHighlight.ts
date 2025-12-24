/**
 * JSON 语法高亮渲染工具
 *
 * 将原始 JSON 字符串转换为带有 Tailwind 颜色 class 的 HTML，
 * 仅用于展示（复制仍使用原始字符串）。
 */

import type { HighlightToken } from "@/lib/highlightTokens";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const indentUnit = "  ";

const indent = (level: number): string => indentUnit.repeat(level);

const pushToken = (out: HighlightToken[], text: string, className?: string) => {
  if (!text) return;
  out.push({ text, className });
};

const formatJsonValueTokens = (value: unknown, depth: number): HighlightToken[] => {
  const currentIndent = indent(depth);
  const nextIndent = indent(depth + 1);

  const out: HighlightToken[] = [];

  if (value === null) {
    pushToken(out, "null", "text-purple-300");
    return out;
  }

  if (typeof value === "number") {
    pushToken(out, String(value), "text-amber-300");
    return out;
  }

  if (typeof value === "boolean") {
    pushToken(out, String(value), "text-emerald-300");
    return out;
  }

  if (typeof value === "string") {
    pushToken(out, `"${value}"`, "text-emerald-200");
    return out;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      pushToken(out, "[]");
      return out;
    }

    pushToken(out, "[\n");
    value.forEach((item, idx) => {
      pushToken(out, nextIndent);
      out.push(...formatJsonValueTokens(item, depth + 1));
      pushToken(out, idx === value.length - 1 ? "\n" : ",\n");
    });
    pushToken(out, `${currentIndent}]`);
    return out;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      pushToken(out, "{}");
      return out;
    }

    pushToken(out, "{\n");
    entries.forEach(([key, v], idx) => {
      pushToken(out, nextIndent);
      pushToken(out, `"${key}"`, "text-sky-400");
      pushToken(out, ": ");
      out.push(...formatJsonValueTokens(v, depth + 1));
      pushToken(out, idx === entries.length - 1 ? "\n" : ",\n");
    });
    pushToken(out, `${currentIndent}}`);
    return out;
  }

  pushToken(out, String(value), "text-foreground");
  return out;
};

const formatJsonValue = (value: unknown, depth: number): string => {
  const currentIndent = indent(depth);
  const nextIndent = indent(depth + 1);

  if (value === null) {
    return '<span class="text-purple-300">null</span>';
  }

  if (typeof value === "number") {
    return `<span class="text-amber-300">${String(value)}</span>`;
  }

  if (typeof value === "boolean") {
    return `<span class="text-emerald-300">${String(value)}</span>`;
  }

  if (typeof value === "string") {
    const escaped = escapeHtml(value);
    return `<span class="text-emerald-200">"${escaped}"</span>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const items = value.map((item) => `${nextIndent}${formatJsonValue(item, depth + 1)}`);

    return `[\n${items.join(",\n")}\n${currentIndent}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }

    const lines = entries.map(([key, v]) => {
      const keyHtml = `<span class="text-sky-400">"${escapeHtml(key)}"</span>`;
      const valueHtml = formatJsonValue(v, depth + 1);
      return `${nextIndent}${keyHtml}: ${valueHtml}`;
    });

    return `{\n${lines.join(",\n")}\n${currentIndent}}`;
  }

  return `<span class="text-foreground">${escapeHtml(String(value))}</span>`;
};

/**
 * 将 JSON 字符串格式化并转换为带 HTML 语法高亮的代码块内容。
 *
 * - 解析成功时：使用两空格缩进重新排版，区分 key / string / number / boolean / null。
 * - 解析失败时：返回简单转义后的原始文本，确保至少可见。
 */
export const highlightJson = (raw: string | null | undefined): string => {
  if (!raw || !raw.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return formatJsonValue(parsed, 0);
  } catch {
    return escapeHtml(raw);
  }
};

export const highlightJsonTokens = (raw: string | null | undefined): HighlightToken[] => {
  if (!raw || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return formatJsonValueTokens(parsed, 0);
  } catch {
    return [{ text: raw }];
  }
};
