import { stripQuotes } from "../utils";

export const readValue = (tokens: string[], i: number, label: string, reasons: string[]): string | null => {
  const value = tokens[i + 1];
  if (!value) {
    reasons.push(`缺少 ${label} 的取值`);
    return null;
  }
  const raw = stripQuotes(value);
  if (raw.startsWith("-")) {
    // Some ffmpeg options accept negative numbers / negative time expressions
    // (e.g. -map_metadata -1, -map_chapters -1, -itsoffset -00:00:01).
    // Treat those as values, but keep rejecting obvious option-like tokens.
    const looksLikeNegativeNumericOrDuration = /^-[0-9.]/.test(raw);
    if (!looksLikeNegativeNumericOrDuration) {
      reasons.push(`缺少 ${label} 的取值`);
      return null;
    }
  }
  return value;
};
