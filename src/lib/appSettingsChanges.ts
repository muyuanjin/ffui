import type { AppSettings } from "@/types";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const copy = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

function rebase(before: unknown, after: unknown, target: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return target;
  if (isObject(before) && isObject(after) && !("mode" in before) && !("mode" in after)) {
    const result: JsonObject = isObject(target) ? { ...target } : {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) {
        delete result[key];
      } else {
        result[key] = rebase(before[key], after[key], result[key]);
      }
    }
    return result;
  }
  return after;
}

export const rebaseAppSettings = (before: AppSettings, after: AppSettings, target: AppSettings): AppSettings =>
  copy(rebase(copy(before), copy(after), copy(target)) as AppSettings);
