import type { PresetFieldDef } from "@/lib/presetEditorContract/parameterSchema";
import { AUTO_VALUE } from "@/lib/presetEditorContract/autoValue";

export const CUSTOM_VALUE = "__custom__";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export const selectItemLabelForField = (
  field: PresetFieldDef<any>,
  model: any,
  value: string,
  t: TranslateFn,
): string => {
  if (field.kind === "enum") {
    if (value === AUTO_VALUE) {
      if (field.unsetLabelKey) return t(field.unsetLabelKey);
      if (field.placeholderKey) return t(field.placeholderKey);
      return t("presetEditor.panel.autoOption");
    }
    const opt = field.options.find((o) => o.value === value);
    if (!opt) return value;
    if (opt.labelKey) return t(opt.labelKey);
    return opt.label ?? value;
  }
  if (field.kind === "inputFileIndexMapping") {
    if (value === AUTO_VALUE) return t(field.autoLabelKey);
    if (value === "-1") return t(field.disableLabelKey);
    if (value === "0") return t(field.copyFromInput0LabelKey);
    const idx = field.getIndex(model);
    const index = typeof idx === "number" && Number.isFinite(idx) ? idx : (field.defaultCustomIndex ?? 1);
    return t(field.copyFromInputNLabelKey, { index });
  }
  if (field.kind === "loopCount") {
    if (value === AUTO_VALUE) return t(field.autoLabelKey);
    if (value === "0") return t(field.noLoopLabelKey);
    if (value === "-1") return t(field.infiniteLabelKey);
    const cnt = field.getCount(model);
    const times = typeof cnt === "number" && Number.isFinite(cnt) && cnt > 0 ? cnt : (field.defaultTimes ?? 1);
    return t(field.timesLabelKey, { times });
  }
  if (field.kind === "timeExpression") {
    if (value === AUTO_VALUE) return t("presetEditor.panel.autoOption");
    if (value === CUSTOM_VALUE) return t(field.customOptionLabelKey);
    const opt = field.presets.find((p) => p.value === value);
    return opt ? t(opt.labelKey) : value;
  }
  return value;
};
