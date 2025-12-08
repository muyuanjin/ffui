import { computed, ref, type Ref, watch } from "vue";
import { escapeHtml, highlightFfmpegCommand } from "@/lib/ffmpegCommand";
import type { TranscodeJob } from "@/types";
import { hasTauri, loadJobDetail } from "@/lib/backend";

// ----- Types -----

export type LogLineKind = "version" | "stream" | "progress" | "error" | "command" | "other";

export interface LogLineEntry {
  text: string;
  kind: LogLineKind;
}

interface StructuredProgressPair {
  key: string;
  value: string;
}

interface StructuredProgressBlock {
  rawLines: string[];
  pairs: Record<string, string>;
}

// ----- Constants -----

/**
 * Structured `-progress pipe:2` output emits many key=value lines per update
 * (frame, fps, bitrate, out_time, speed, progress, etc.). Rendering each of
 * these as its own visual row makes the task detail log appear extremely tall
 * and "full of blank space", even though the information density is low. To
 * keep the UI readable, we collapse each structured progress *block* into a
 * single synthetic display line while preserving the underlying raw text in
 * `jobDetailLogText` for copy/diagnostics.
 */
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

// ----- Helper Functions -----

/**
 * Classify a log line by its content to determine styling.
 */
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

/**
 * Get the CSS class for a log line based on its kind.
 */
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

/**
 * Highlight FFmpeg progress log line tokens with color coding.
 */
export const highlightFfmpegProgressLogLine = (line: string): string => {
  // Split into tokens while preserving whitespace segments so textContent
  // remains identical to the original line for copy/select operations.
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
      } else if (
        lower.startsWith("time=") ||
        lower.startsWith("out_time=") ||
        lower.startsWith("out_time_ms=")
      ) {
        cls = "text-lime-300";
      } else if (lower.startsWith("speed=")) {
        cls = "text-purple-300";
      } else if (lower.startsWith("progress=")) {
        cls = lower.includes("end")
          ? "text-emerald-400 font-semibold"
          : "text-muted-foreground";
      }

      const escaped = escapeHtml(segment);
      if (!cls) return escaped;
      return `<span class="${cls}">${escaped}</span>`;
    })
    .join("");
};

/**
 * Render a highlighted log line entry as HTML.
 */
export const renderHighlightedLogLine = (entry: LogLineEntry): string => {
  const cls = logLineClass(entry.kind);
  const title = escapeHtml(entry.text);

  let contentHtml = "";
  if (entry.kind === "progress") {
    contentHtml = highlightFfmpegProgressLogLine(entry.text);
  } else if (entry.kind === "command") {
    // `command: ffmpeg ...` 日志：前缀保持原样，命令部分复用 ffmpegCommand 的高亮逻辑。
    const idx = entry.text.toLowerCase().indexOf("command:");
    const prefix = idx >= 0 ? entry.text.slice(0, idx + "command:".length) : "command:";
    const rest =
      idx >= 0 ? entry.text.slice(idx + "command:".length).trimStart() : entry.text;
    const highlightedCmd = highlightFfmpegCommand(rest);
    contentHtml = `${escapeHtml(prefix)} ${highlightedCmd}`;
  } else {
    contentHtml = escapeHtml(entry.text);
  }

  return `<div class="${cls}" title="${title}">${contentHtml}</div>`;
};

/**
 * Parse a structured progress key=value pair from a log line.
 */
export const parseStructuredProgressPair = (line: string): StructuredProgressPair | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex);
  if (!STRUCTURED_PROGRESS_KEYS.has(key)) return null;

  const rawValue = trimmed.slice(eqIndex + 1);
  const value = rawValue.trim();

  // Traditional human stats lines look like:
  //   frame=   10 fps=0.0 q=-1.0 size=... time=... speed=...
  // where the value segment after '=' still contains spaces and additional
  // tokens. Treat those as normal log lines so they stay on their own row.
  if (value.includes(" ")) {
    return null;
  }

  if (!value) return null;

  return { key, value };
};

/**
 * Flush a structured progress block into a single synthetic log entry.
 */
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

  // If, for some reason, we failed to pick any fields, fall back to a simple
  // space-joined view of the raw lines so no diagnostic information is lost.
  const text =
    parts.length > 0 ? parts.join("  ") : block.rawLines.join(" ").replace(/\s+/g, " ");

  entries.push({
    text,
    kind: classifyLogLine(text),
  });

  return null;
};

/**
 * Parse raw log text and produce highlighted HTML output.
 * This collapses structured progress blocks into single lines for readability.
 */
export const parseAndHighlightLog = (raw: string | undefined | null): string => {
  if (typeof raw !== "string" || !raw) return "";

  // Normalize line endings so we can safely split into logical lines.
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const entries: LogLineEntry[] = [];
  let block: StructuredProgressBlock | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const kv = parseStructuredProgressPair(line);
    if (kv) {
      if (!block) {
        block = {
          rawLines: [],
          pairs: {},
        };
      }

      block.rawLines.push(line);
      block.pairs[kv.key] = kv.value;

      // Each `progress=...` marker ends a structured block. We render that
      // block as a single synthetic progress row instead of 10+ tiny lines.
      if (kv.key === "progress") {
        block = flushStructuredProgressBlock(block, entries);
      }
      continue;
    }

    // Non-structured lines terminate any in-flight structured block so that
    // partial/truncated progress output still collapses cleanly.
    if (block) {
      block = flushStructuredProgressBlock(block, entries);
    }

    entries.push({
      text: line,
      kind: classifyLogLine(line),
    });
  }

  // Flush trailing structured block if the log ended without an explicit
  // `progress=...` marker.
  if (block) {
    flushStructuredProgressBlock(block, entries);
  }

  // Avoid injecting extra newline text nodes between blocks; each log line is
  // rendered as its own <div>, so concatenating without separators prevents
  // spurious blank rows while keeping copy semantics via textContent.
  return entries.map((entry) => renderHighlightedLogLine(entry)).join("");
};

// ----- Composable -----

export interface UseJobLogOptions {
  /** The currently selected job for detail view. */
  selectedJob: Ref<TranscodeJob | null>;
}

export interface UseJobLogReturn {
  /** Raw log text from the selected job. */
  jobDetailLogText: Ref<string>;
  /** Highlighted HTML output for rendering in the UI. */
  highlightedLogHtml: Ref<string>;
}

/**
 * Composable for handling job log display and formatting.
 * Extracts log text from a selected job and produces highlighted HTML output.
 */
export function useJobLog(options: UseJobLogOptions): UseJobLogReturn {
  const { selectedJob } = options;

  const effectiveJob = ref<TranscodeJob | null>(null);

  const maybeHydrateFromBackend = async (job: TranscodeJob | null) => {
    if (!job) return;
    if (!hasTauri()) return;
    if (!job.id) return;
    if (job.logs && job.logs.length > 0) return;

    try {
      const full = await loadJobDetail(job.id);
      // Only apply the fetched detail if it still matches the currently
      // selected job to avoid races when the user switches selection.
      if (full && full.id === (selectedJob.value && selectedJob.value.id)) {
        effectiveJob.value = full;
      }
    } catch (error) {
      console.error("Failed to load job detail from backend", error);
    }
  };

  watch(
    selectedJob,
    (job) => {
      effectiveJob.value = job;
      void maybeHydrateFromBackend(job);
    },
    { immediate: true },
  );

  const jobDetailLogText = computed<string>(() => {
    const job = effectiveJob.value;
    if (!job) return "";
    const full = job.logs?.length ? job.logs.join("\n") : "";
    const tailRaw = job.logTail ?? "";
    const tail = Array.isArray(tailRaw) ? tailRaw.join("\n") : tailRaw;
    // 优先使用内存中的完整日志；若不可用则回退到后端提供的尾部日志，避免只看到截断末尾。
    return full || tail;
  });

  const highlightedLogHtml = computed<string>(() => {
    return parseAndHighlightLog(jobDetailLogText.value);
  });

  return {
    jobDetailLogText,
    highlightedLogHtml,
  };
}

export default useJobLog;
