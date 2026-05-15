import type { Translate } from "@/types";

export type TimeDisplayPartKind = "label" | "value" | "separator";

export interface TimeDisplayPart {
  kind: TimeDisplayPartKind;
  text: string;
}

const part = (kind: TimeDisplayPartKind, text: string): TimeDisplayPart | null => {
  const normalized = kind === "separator" ? text : text.trim();
  return normalized ? { kind, text: normalized } : null;
};

export const compactTimeDisplayParts = (parts: Array<TimeDisplayPart | null>): TimeDisplayPart[] => {
  return parts.filter((item): item is TimeDisplayPart => item != null);
};

export const joinTimeDisplayParts = (parts: TimeDisplayPart[]): string => {
  return parts.map((item) => item.text).join("");
};

export const translatedTimeParts = (t: Translate, key: string, time: string): TimeDisplayPart[] => {
  const text = String(t(key, { time }));
  const index = text.indexOf(time);
  if (index < 0) {
    return compactTimeDisplayParts([labelPart(text)]);
  }

  const before = text.slice(0, index).trim();
  const after = text.slice(index + time.length).trim();

  return compactTimeDisplayParts([
    labelPart(before),
    before ? separatorPart(" ") : null,
    valuePart(time),
    after ? separatorPart(" ") : null,
    labelPart(after),
  ]);
};

export const separatorPart = (text: string): TimeDisplayPart => ({
  kind: "separator",
  text,
});

export const labelPart = (text: string): TimeDisplayPart | null => part("label", text);

export const valuePart = (text: string): TimeDisplayPart | null => part("value", text);
