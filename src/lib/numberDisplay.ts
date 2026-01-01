export type FixedDisplay = { text: string; value: number };

const clampDigits = (digits: number): number => {
  if (!Number.isFinite(digits)) return 0;
  return Math.max(0, Math.min(6, Math.floor(digits)));
};

export const toFixedDisplay = (value: unknown, digits: number): FixedDisplay | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const d = clampDigits(digits);
  const text = value.toFixed(d);
  const rounded = Number(text);
  if (!Number.isFinite(rounded)) return null;
  return { text, value: rounded };
};
