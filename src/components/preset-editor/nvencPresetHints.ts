export type NvencPresetHintId = "fastest" | "fast" | "balancedRecommended" | "quality" | "bestQualitySlowest";

const normalizePresetValue = (value: string): string =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const isNvencPresetValue = (value: string): boolean => {
  const v = normalizePresetValue(value);
  return /^p\d+$/.test(v);
};

export const getNvencPresetHintId = (value: string): NvencPresetHintId | null => {
  const v = normalizePresetValue(value);
  if (v === "p1") return "fastest";
  if (v === "p2" || v === "p3") return "fast";
  if (v === "p4" || v === "p5") return "balancedRecommended";
  if (v === "p6") return "quality";
  if (v === "p7") return "bestQualitySlowest";
  return null;
};

export const getNvencPresetHintClass = (value: string): string => {
  const v = normalizePresetValue(value);
  if (v === "p4" || v === "p5") return "text-emerald-300";
  if (v === "p1") return "text-amber-300";
  if (v === "p7") return "text-sky-300";
  return "text-muted-foreground";
};
