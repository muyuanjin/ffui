import type { TranscodeJob } from "@/types";

export type SizeFilter = { op: ">" | "<" | ">=" | "<=" | "="; valueMb: number };

export const parseSizeFilterToken = (token: string): SizeFilter | null => {
  const trimmed = token.trim();
  if (!trimmed.toLowerCase().startsWith("size")) return null;

  const match = trimmed.match(/^size(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)?)(kb|mb|gb)?$/i);
  if (!match) return null;

  const [, opRaw, valueRaw, unitRaw] = match;
  const op = (opRaw as SizeFilter["op"] | undefined) ?? ">";
  const numeric = Number.parseFloat(valueRaw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const unit = (unitRaw || "mb").toLowerCase();
  let valueMb = numeric;
  if (unit === "kb") valueMb = numeric / 1024;
  else if (unit === "gb") valueMb = numeric * 1024;

  return { op, valueMb };
};

export const getJobEffectiveSizeMb = (job: TranscodeJob): number | null => {
  if (typeof job.mediaInfo?.sizeMB === "number") return job.mediaInfo.sizeMB;
  if (typeof job.originalSizeMB === "number") return job.originalSizeMB;
  return null;
};

export const matchesSizeFilter = (job: TranscodeJob, filter: SizeFilter | null): boolean => {
  if (!filter) return true;
  const sizeMb = getJobEffectiveSizeMb(job);
  if (sizeMb == null) return false;

  const value = filter.valueMb;
  switch (filter.op) {
    case ">":
      return sizeMb > value;
    case ">=":
      return sizeMb >= value;
    case "<":
      return sizeMb < value;
    case "<=":
      return sizeMb <= value;
    case "=":
      return sizeMb === value;
    default:
      return true;
  }
};
