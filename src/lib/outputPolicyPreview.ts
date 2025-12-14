import type { OutputFilenameAppend, OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

const DEFAULT_APPEND_ORDER: OutputFilenameAppend[] =
  DEFAULT_OUTPUT_POLICY.filename.appendOrder ?? ["suffix", "timestamp", "encoderQuality", "random"];

export function normalizeAppendOrder(
  order: OutputFilenameAppend[] | undefined,
): OutputFilenameAppend[] {
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

export function previewOutputPathLocal(inputPath: string, policy: OutputPolicy): string {
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
      ? String(policy.container.format || ext).trim().replace(/^\./, "") || ext
      : policy.container.mode === "keepInput"
        ? ext
        : ext;

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
    if (typeof policy.filename.randomSuffixLen === "number" && policy.filename.randomSuffixLen > 0) {
      outStem = `${outStem}-RANDOM`;
    }
  }

  const outDirTrimmed = outDir.replace(/\/+$/, "");
  const joiner = outDirTrimmed ? `${outDirTrimmed}/` : "";
  return `${joiner}${outStem}.${outExt}`;
}
