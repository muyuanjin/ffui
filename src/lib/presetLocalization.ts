import type { FFmpegPreset } from "@/types";

/**
 * Resolve preset description with locale fallback.
 * Prefers exact locale (e.g. `en-US`), then language base (e.g. `en`), then the default description.
 */
export const resolvePresetDescription = (preset: FFmpegPreset, locale: string): string => {
  const dict = preset.descriptionI18n;
  const fallback = preset.description ?? "";
  if (!dict) return fallback;

  const normalized = locale?.trim();
  const lower = normalized?.toLowerCase();
  const base = normalized?.split(/[-_]/)[0];
  const baseLower = lower?.split(/[-_]/)[0];

  for (const key of [normalized, lower, base, baseLower]) {
    if (!key) continue;
    const value = dict[key];
    if (value !== undefined) {
      return value;
    }
  }

  return fallback;
};
