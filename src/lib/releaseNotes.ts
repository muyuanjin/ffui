import type { AppLocale } from "@/i18n";

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function findSectionBounds(lines: string[], header: RegExp): { start: number; end: number } | null {
  const startIdx = lines.findIndex((line) => header.test(line.trim()));
  if (startIdx < 0) return null;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) {
      return { start: startIdx + 1, end: i };
    }
  }
  return { start: startIdx + 1, end: lines.length };
}

function extractBullets(lines: string[], start: number, end: number): string[] {
  const items: string[] = [];
  let current: string | null = null;

  for (let i = start; i < end; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (/^#{2,6}\s+/.test(trimmed)) break;

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (current) items.push(current);
      current = bullet[1]?.trim() ?? "";
      continue;
    }

    const continuation = current != null && /^\s{2,}\S/.test(line);
    if (continuation) {
      current = `${current} ${trimmed}`.trim();
      continue;
    }

    if (trimmed === "") continue;

    if (current) {
      items.push(current);
      current = null;
    }
    break;
  }

  if (current) items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

function extractHighlightsFromRange(lines: string[], start: number, end: number, heading: RegExp): string[] {
  for (let i = start; i < end; i++) {
    if (heading.test(lines[i]?.trim() ?? "")) {
      return extractBullets(lines, i + 1, end);
    }
  }
  return [];
}

function extractFirstBullets(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (/^#{2,6}\s+/.test(trimmed)) continue;
    if (/^[-*]\s+/.test(trimmed)) {
      return extractBullets(lines, i, lines.length);
    }
  }
  return [];
}

export function extractReleaseHighlights(body: string, locale: AppLocale): string[] {
  if (typeof body !== "string" || body.trim().length === 0) return [];

  const lines = normalizeNewlines(body).split("\n");
  const isChinese = locale === "zh-CN";

  const sectionHeader = isChinese ? /^##\s+中文\s*$/ : /^##\s+English\s*$/;
  const highlightsHeader = isChinese ? /^###\s+重点更新\s*$/ : /^###\s+Highlights\s*$/;

  const section = findSectionBounds(lines, sectionHeader);
  if (section) {
    const scoped = extractHighlightsFromRange(lines, section.start, section.end, highlightsHeader);
    if (scoped.length > 0) return scoped;
  }

  const any = extractHighlightsFromRange(lines, 0, lines.length, highlightsHeader);
  if (any.length > 0) return any;

  return extractFirstBullets(lines);
}
