import type { PresetCardFooterItemKey, PresetCardFooterLayout, PresetCardFooterSettings } from "@/types";

export const DEFAULT_PRESET_CARD_FOOTER_SETTINGS: Required<PresetCardFooterSettings> = {
  layout: "twoRows",
  order: ["avgSize", "fps", "vmaf", "usedCount", "dataAmount", "throughput"],
  showAvgSize: true,
  showFps: true,
  showVmaf: true,
  showUsedCount: true,
  showDataAmount: true,
  showThroughput: true,
};

const normalizeOrder = (order: PresetCardFooterItemKey[] | undefined): PresetCardFooterItemKey[] => {
  const defaults = DEFAULT_PRESET_CARD_FOOTER_SETTINGS.order;
  const rawOrder = Array.isArray(order) ? order : [];
  const seen = new Set<PresetCardFooterItemKey>();
  const out: PresetCardFooterItemKey[] = [];

  for (const key of rawOrder) {
    if (!defaults.includes(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  for (const key of defaults) {
    if (!seen.has(key)) out.push(key);
  }

  return out;
};

export const normalizePresetCardFooterSettings = (
  raw: PresetCardFooterSettings | null | undefined,
): Required<PresetCardFooterSettings> => {
  const layout: PresetCardFooterLayout =
    raw?.layout === "oneRow" || raw?.layout === "twoRows" ? raw.layout : DEFAULT_PRESET_CARD_FOOTER_SETTINGS.layout;

  return {
    layout,
    order: normalizeOrder(raw?.order),
    showAvgSize: raw?.showAvgSize ?? DEFAULT_PRESET_CARD_FOOTER_SETTINGS.showAvgSize,
    showFps: raw?.showFps ?? DEFAULT_PRESET_CARD_FOOTER_SETTINGS.showFps,
    showVmaf: raw?.showVmaf ?? DEFAULT_PRESET_CARD_FOOTER_SETTINGS.showVmaf,
    showUsedCount: raw?.showUsedCount ?? DEFAULT_PRESET_CARD_FOOTER_SETTINGS.showUsedCount,
    showDataAmount: raw?.showDataAmount ?? DEFAULT_PRESET_CARD_FOOTER_SETTINGS.showDataAmount,
    showThroughput: raw?.showThroughput ?? DEFAULT_PRESET_CARD_FOOTER_SETTINGS.showThroughput,
  };
};
