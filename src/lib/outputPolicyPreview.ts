import type { FFmpegPreset, OutputFilenameAppend, OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

const DEFAULT_APPEND_ORDER: OutputFilenameAppend[] = DEFAULT_OUTPUT_POLICY.filename.appendOrder ?? [
  "suffix",
  "timestamp",
  "encoderQuality",
  "random",
];

export function normalizeAppendOrder(order: OutputFilenameAppend[] | undefined): OutputFilenameAppend[] {
  const seen = new Set<OutputFilenameAppend>();
  const out: OutputFilenameAppend[] = [];
  for (const item of order ?? []) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  for (const item of DEFAULT_APPEND_ORDER) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function normalizeContainerFormatForPreview(value: string): string {
  const trimmed = value.trim().replace(/^\./, "").toLowerCase();
  if (!trimmed) return "";

  if (trimmed === "mp4") return "mp4";
  if (trimmed === "mkv" || trimmed === "matroska") return "mkv";
  if (trimmed === "mov") return "mov";
  if (trimmed === "webm") return "webm";
  if (trimmed === "flv") return "flv";
  if (trimmed === "avi") return "avi";
  if (trimmed === "mxf") return "mxf";
  if (trimmed === "3gp") return "3gp";
  if (trimmed === "asf" || trimmed === "wmv") return "wmv";
  if (trimmed === "rm" || trimmed === "rmvb") return "rmvb";
  if (trimmed === "m4a") return "m4a";
  if (trimmed === "mp3") return "mp3";
  if (trimmed === "aac" || trimmed === "adts") return "aac";
  if (trimmed === "wav") return "wav";
  if (trimmed === "flac") return "flac";
  if (trimmed === "aiff") return "aiff";
  if (trimmed === "ac3") return "ac3";
  if (trimmed === "ogg") return "ogg";
  if (trimmed === "opus") return "opus";
  if (trimmed === "mpegts" || trimmed === "ts") return "ts";
  if (trimmed === "hls") return "m3u8";
  if (trimmed === "dash") return "mpd";
  return "";
}

export function normalizeForcedContainerExtensionForPreview(value: string): string {
  return value.trim().replace(/^\./, "").toLowerCase();
}

function splitTemplateArgs(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of template) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((ch === '"' || ch === "'") && quote === null) {
      quote = ch;
      continue;
    }
    if (quote === ch) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (current) args.push(current);
  return args;
}

export function inferTemplateOutputContainer(template: string): string | null {
  const tokens = splitTemplateArgs(template.trim());
  if (/^(ffmpeg|ffmpeg\.exe)$/i.test(tokens[0] ?? "")) tokens.shift();
  const outputIndex = tokens.findIndex((token) => token === "OUTPUT");
  if (outputIndex <= 0) return null;

  let lastInputIndex: number | null = null;
  for (let i = 0; i + 1 < outputIndex; i += 1) {
    if (tokens[i] === "-i") {
      lastInputIndex = i + 1;
      i += 1;
    }
  }

  const start = lastInputIndex == null ? 0 : lastInputIndex + 1;
  let format: string | null = null;
  for (let i = start; i + 1 < outputIndex; i += 1) {
    if (tokens[i] === "-f") {
      format = tokens[i + 1] ?? null;
      i += 1;
    }
  }

  const normalized = format ? normalizeContainerFormatForPreview(format) : "";
  return normalized || null;
}

export function inferPresetDefaultOutputContainer(preset: FFmpegPreset | null | undefined): string | null {
  if (!preset) return null;

  if (preset.advancedEnabled && preset.ffmpegTemplate?.trim()) {
    const fromTemplate = inferTemplateOutputContainer(preset.ffmpegTemplate);
    if (fromTemplate) return fromTemplate;
  }

  const structured = preset.container?.format ? normalizeContainerFormatForPreview(preset.container.format) : "";
  return structured || null;
}

export function previewOutputPathLocal(
  inputPath: string,
  policy: OutputPolicy,
  options: { preset?: FFmpegPreset | null } = {},
): string {
  const raw = inputPath.trim();
  if (!raw) return "";

  const normalizedInput = raw.replace(/\\/g, "/");
  const lastSlash = normalizedInput.lastIndexOf("/");
  const dir = lastSlash >= 0 ? normalizedInput.slice(0, lastSlash) : "";
  const file = lastSlash >= 0 ? normalizedInput.slice(lastSlash + 1) : normalizedInput;
  const lastDot = file.lastIndexOf(".");
  const stem = lastDot > 0 ? file.slice(0, lastDot) : file;
  const ext = lastDot > 0 ? file.slice(lastDot + 1) : "mp4";

  const outDir =
    policy.directory.mode === "fixed" && policy.directory.directory?.trim()
      ? policy.directory.directory.trim().replace(/\\/g, "/")
      : dir;

  const outExt =
    policy.container.mode === "force"
      ? normalizeForcedContainerExtensionForPreview(String(policy.container.format || ext)) || ext
      : policy.container.mode === "keepInput"
        ? ext
        : (inferPresetDefaultOutputContainer(options.preset) ?? ext);

  let outStem = stem;
  if (policy.filename.regexReplace?.pattern) {
    try {
      const re = new RegExp(policy.filename.regexReplace.pattern);
      outStem = outStem.replace(re, policy.filename.regexReplace.replacement ?? "");
    } catch {
      // ignore invalid regex in preview (Rust will validate at runtime)
    }
  }

  if (policy.filename.prefix) outStem = `${policy.filename.prefix}${outStem}`;

  for (const item of normalizeAppendOrder(policy.filename.appendOrder)) {
    if (item === "suffix") {
      if (policy.filename.suffix) outStem = `${outStem}${policy.filename.suffix}`;
      continue;
    }
    if (item === "timestamp") {
      if (policy.filename.appendTimestamp) outStem = `${outStem}-YYYYMMDD-HHmmss`;
      continue;
    }
    if (item === "encoderQuality") {
      if (policy.filename.appendEncoderQuality) outStem = `${outStem}-ENC-QUALITY`;
      continue;
    }
    if (item === "random") {
      if (typeof policy.filename.randomSuffixLen === "number" && policy.filename.randomSuffixLen > 0) {
        outStem = `${outStem}-RANDOM`;
      }
      continue;
    }
  }

  const outDirTrimmed = outDir.replace(/\/+$/, "");
  const joiner = outDirTrimmed ? `${outDirTrimmed}/` : "";
  return `${joiner}${outStem}.${outExt}`;
}
