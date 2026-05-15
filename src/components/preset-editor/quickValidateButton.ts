import type { PresetTemplateValidationResult, Translate } from "@/types";

type QuickValidateButtonLabelOptions = {
  showQuickValidate?: boolean;
  isHovering: boolean;
  isBusy: boolean;
  result: PresetTemplateValidationResult | null | undefined;
  t: Translate;
};

export function getQuickValidateButtonLabel(options: QuickValidateButtonLabelOptions): string {
  if (options.showQuickValidate === false) return "";
  if (options.isHovering) return options.t("presetEditor.advanced.quickValidateButton");
  if (options.isBusy) return options.t("presetEditor.advanced.quickValidate.running");

  const outcome = options.result?.outcome ?? null;
  if (!outcome) return options.t("presetEditor.advanced.quickValidateButton");
  if (outcome === "ok") return options.t("presetEditor.advanced.quickValidate.ok");
  if (outcome === "failed") return options.t("presetEditor.advanced.quickValidate.failed");
  if (outcome === "timedOut") return options.t("presetEditor.advanced.quickValidate.timedOut");
  if (outcome === "skippedToolUnavailable") return options.t("presetEditor.advanced.quickValidate.toolMissing");
  if (outcome === "templateInvalid") return options.t("presetEditor.advanced.quickValidate.templateInvalid");
  return options.t("presetEditor.advanced.quickValidate.failed");
}

export function getQuickValidateButtonToneClass(options: {
  isHovering: boolean;
  isBusy: boolean;
  result: PresetTemplateValidationResult | null | undefined;
}): string {
  if (options.isHovering) return "";
  if (options.isBusy) return "";
  const outcome = options.result?.outcome ?? null;
  if (!outcome) return "";
  if (outcome === "ok") return "text-emerald-400";
  if (outcome === "skippedToolUnavailable" || outcome === "templateInvalid") return "text-amber-400";
  return "text-destructive";
}
