import { escapeHtml, highlightFfmpegCommand, highlightFfmpegCommandTokens } from "@/lib/ffmpegCommand";
import type { HighlightToken } from "@/lib/highlightTokens";

export type LogLineKind = "version" | "stream" | "progress" | "error" | "command" | "other";

export interface LogLineEntry {
  text: string;
  kind: LogLineKind;
  timestampPrefix?: string;
  rawText?: string;
}

interface StructuredProgressPair {
  key: string;
  value: string;
}

interface StructuredProgressBlock {
  rawLines: string[];
  pairs: Record<string, string>;
  timestampPrefix?: string;
}

const STRUCTURED_PROGRESS_KEYS = new Set([
  "frame",
  "fps",
  "stream_0_0_q",
  "bitrate",
  "total_size",
  "out_time_us",
  "out_time_ms",
  "out_time",
  "dup_frames",
  "drop_frames",
  "speed",
  "progress",
]);

const TIMESTAMP_PREFIX_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]\s+/;

const splitTimestampPrefix = (line: string): { timestampPrefix?: string; rest: string } => {
  const match = TIMESTAMP_PREFIX_RE.exec(line);
  if (!match) return { rest: line };
  return { timestampPrefix: `[${match[1]}]`, rest: line.slice(match[0].length) };
};

export const classifyLogLine = (line: string): LogLineKind => {
  const lower = line.toLowerCase();
  if (lower.trimStart().startsWith("command:")) return "command";
  if (lower.includes("ffmpeg version")) return "version";
  if (lower.trimStart().startsWith("stream #") || lower.includes("video:") || lower.includes("audio:")) {
    return "stream";
  }
  if (lower.trimStart().startsWith("frame=") || (lower.includes("time=") && lower.includes("speed="))) {
    return "progress";
  }
  if (lower.includes("error") || lower.includes("failed") || lower.includes("exited with")) {
    return "error";
  }
  return "other";
};

export const logLineClass = (kind: LogLineKind): string => {
  switch (kind) {
    case "version":
    case "stream":
      return "leading-relaxed text-[11px] text-muted-foreground";
    case "command":
      return "leading-relaxed text-[11px] text-emerald-300";
    case "progress":
      return "leading-relaxed text-[11px] text-foreground";
    case "error":
      return "leading-relaxed text-[11px] text-destructive font-medium";
    default:
      return "leading-relaxed text-[11px] text-foreground";
  }
};

export const highlightFfmpegProgressLogLine = (line: string): string => {
  const segments = line.split(/(\s+)/);

  return segments
    .map((segment) => {
      if (!segment.trim()) {
        return escapeHtml(segment);
      }

      const lower = segment.toLowerCase();
      let cls = "";

      if (lower.startsWith("frame=")) {
        cls = "text-emerald-300";
      } else if (lower.startsWith("fps=")) {
        cls = "text-sky-300";
      } else if (lower.startsWith("bitrate=")) {
        cls = "text-amber-300";
      } else if (lower.startsWith("time=") || lower.startsWith("out_time=") || lower.startsWith("out_time_ms=")) {
        cls = "text-lime-300";
      } else if (lower.startsWith("speed=")) {
        cls = "text-purple-300";
      } else if (lower.startsWith("progress=")) {
        cls = lower.includes("end") ? "text-emerald-400 font-semibold" : "text-muted-foreground";
      }

      const escaped = escapeHtml(segment);
      if (!cls) return escaped;
      return `<span class="${cls}">${escaped}</span>`;
    })
    .join("");
};

export const highlightFfmpegProgressLogLineTokens = (line: string): HighlightToken[] => {
  const segments = line.split(/(\s+)/);

  return segments.map((segment) => {
    if (!segment.trim()) {
      return { text: segment };
    }

    const lower = segment.toLowerCase();
    let className: string | undefined;

    if (lower.startsWith("frame=")) {
      className = "text-emerald-300";
    } else if (lower.startsWith("fps=")) {
      className = "text-sky-300";
    } else if (lower.startsWith("bitrate=")) {
      className = "text-amber-300";
    } else if (lower.startsWith("time=") || lower.startsWith("out_time=") || lower.startsWith("out_time_ms=")) {
      className = "text-lime-300";
    } else if (lower.startsWith("speed=")) {
      className = "text-purple-300";
    } else if (lower.startsWith("progress=")) {
      className = lower.includes("end") ? "text-emerald-400 font-semibold" : "text-muted-foreground";
    }

    return { text: segment, className };
  });
};

export const renderHighlightedLogLine = (entry: LogLineEntry): string => {
  const cls = logLineClass(entry.kind);
  const title = escapeHtml(entry.rawText ?? entry.text);
  const tsPrefix = entry.timestampPrefix
    ? `<span class="text-muted-foreground">${escapeHtml(entry.timestampPrefix)} </span>`
    : "";

  let contentHtml = "";
  if (entry.kind === "progress") {
    contentHtml = highlightFfmpegProgressLogLine(entry.text);
  } else if (entry.kind === "command") {
    const idx = entry.text.toLowerCase().indexOf("command:");
    const prefix = idx >= 0 ? entry.text.slice(0, idx + "command:".length) : "command:";
    const rest = idx >= 0 ? entry.text.slice(idx + "command:".length).trimStart() : entry.text;
    const highlightedCmd = highlightFfmpegCommand(rest);
    contentHtml = `${escapeHtml(prefix)} ${highlightedCmd}`;
  } else {
    contentHtml = escapeHtml(entry.text);
  }

  return `<div class="${cls}" title="${title}">${tsPrefix}${contentHtml}</div>`;
};

export interface HighlightedLogLine {
  className: string;
  title: string;
  tokens: HighlightToken[];
}

export const renderHighlightedLogLineTokens = (entry: LogLineEntry): HighlightToken[] => {
  const prefixTokens: HighlightToken[] = entry.timestampPrefix
    ? [{ text: `${entry.timestampPrefix} `, className: "text-muted-foreground" }]
    : [];

  if (entry.kind === "progress") {
    return [...prefixTokens, ...highlightFfmpegProgressLogLineTokens(entry.text)];
  }

  if (entry.kind === "command") {
    const idx = entry.text.toLowerCase().indexOf("command:");
    const prefix = idx >= 0 ? entry.text.slice(0, idx + "command:".length) : "command:";
    const rest = idx >= 0 ? entry.text.slice(idx + "command:".length).trimStart() : entry.text;
    const tokens = highlightFfmpegCommandTokens(rest);
    const space = rest ? " " : "";
    return [...prefixTokens, { text: `${prefix}${space}` }, ...tokens];
  }

  return prefixTokens.length ? [...prefixTokens, { text: entry.text }] : [{ text: entry.text }];
};

export const parseStructuredProgressPair = (line: string): StructuredProgressPair | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex);
  if (!STRUCTURED_PROGRESS_KEYS.has(key)) return null;

  const rawValue = trimmed.slice(eqIndex + 1);
  const value = rawValue.trim();

  if (value.includes(" ")) {
    return null;
  }

  if (!value) return null;

  return { key, value };
};

export const flushStructuredProgressBlock = (
  block: StructuredProgressBlock | null,
  entries: LogLineEntry[],
): StructuredProgressBlock | null => {
  if (!block || block.rawLines.length === 0) {
    return null;
  }

  const pairs = block.pairs;
  const parts: string[] = [];

  if (pairs.frame) parts.push(`frame=${pairs.frame}`);
  if (pairs.fps) parts.push(`fps=${pairs.fps}`);
  if (pairs.stream_0_0_q) parts.push(`stream_0_0_q=${pairs.stream_0_0_q}`);
  if (pairs.bitrate) {
    parts.push(`bitrate=${pairs.bitrate}`);
  } else if (pairs.total_size) {
    parts.push(`total_size=${pairs.total_size}`);
  }

  if (pairs.out_time) {
    parts.push(`out_time=${pairs.out_time}`);
  } else if (pairs.out_time_ms) {
    parts.push(`out_time_ms=${pairs.out_time_ms}`);
  } else if (pairs.out_time_us) {
    parts.push(`out_time_us=${pairs.out_time_us}`);
  }

  if (pairs.dup_frames) parts.push(`dup_frames=${pairs.dup_frames}`);
  if (pairs.drop_frames) parts.push(`drop_frames=${pairs.drop_frames}`);
  if (pairs.speed) parts.push(`speed=${pairs.speed}`);
  if (pairs.progress) parts.push(`progress=${pairs.progress}`);

  const text = parts.length > 0 ? parts.join("  ") : block.rawLines.join(" ").replace(/\s+/g, " ");

  entries.push({
    text,
    kind: classifyLogLine(text),
    timestampPrefix: block.timestampPrefix,
    rawText: block.timestampPrefix ? `${block.timestampPrefix} ${text}` : text,
  });

  return null;
};

const parseLogEntries = (raw: string | undefined | null): LogLineEntry[] => {
  if (typeof raw !== "string" || !raw) return [];

  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const entries: LogLineEntry[] = [];
  let block: StructuredProgressBlock | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const { timestampPrefix, rest } = splitTimestampPrefix(line);
    const kv = parseStructuredProgressPair(rest);
    if (kv) {
      if (!block) {
        block = {
          rawLines: [],
          pairs: {},
        };
      }

      block.rawLines.push(rest);
      block.pairs[kv.key] = kv.value;
      if (timestampPrefix) block.timestampPrefix = timestampPrefix;

      if (kv.key === "progress") {
        block = flushStructuredProgressBlock(block, entries);
      }
      continue;
    }

    if (block) {
      block = flushStructuredProgressBlock(block, entries);
    }

    entries.push({
      text: rest,
      kind: classifyLogLine(rest),
      timestampPrefix,
      rawText: line,
    });
  }

  if (block) {
    flushStructuredProgressBlock(block, entries);
  }

  return entries;
};

export const parseAndHighlightLogTokens = (raw: string | undefined | null): HighlightedLogLine[] => {
  return parseLogEntries(raw).map((entry) => ({
    className: logLineClass(entry.kind),
    title: entry.rawText ?? entry.text,
    tokens: renderHighlightedLogLineTokens(entry),
  }));
};

export const parseAndHighlightLog = (raw: string | undefined | null): string => {
  return parseLogEntries(raw)
    .map((entry) => renderHighlightedLogLine(entry))
    .join("");
};
