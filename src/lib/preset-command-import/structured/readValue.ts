import { stripQuotes } from "../utils";

export const readValue = (tokens: string[], i: number, label: string, reasons: string[]): string | null => {
  const value = tokens[i + 1];
  if (!value) {
    reasons.push(`缺少 ${label} 的取值`);
    return null;
  }
  const raw = stripQuotes(value);
  if (raw.startsWith("-")) {
    reasons.push(`缺少 ${label} 的取值`);
    return null;
  }
  return value;
};
