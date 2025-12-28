import type { QueueProgressStyle } from "@/types";

export function coerceQueueProgressStyleForPerf(
  style: QueueProgressStyle,
  allowHeavyEffects: boolean,
): QueueProgressStyle {
  if (allowHeavyEffects) return style;
  if (style === "card-fill" || style === "ripple-card") return "bar";
  return style;
}
