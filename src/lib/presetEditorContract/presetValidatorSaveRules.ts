import type { PresetEditorIssue, PresetEditorMutableState } from "./presetValidatorTypes";
import { getEncoderCapability } from "./encoderCapabilityRegistry";
import { parseFpsExpression } from "@/lib/fpsExpression";

export const appendPresetSaveContractIssues = (state: PresetEditorMutableState, issues: PresetEditorIssue[]) => {
  const template = state.ffmpegTemplate.value.trim();
  if (state.advancedEnabled.value && template.length > 0) {
    const inputCount = (template.match(/\bINPUT\b/g) ?? []).length;
    const outputCount = (template.match(/\bOUTPUT\b/g) ?? []).length;
    if (inputCount !== 1 || outputCount !== 1) {
      issues.push({
        level: "error",
        group: "command",
        field: "template",
        messageKey: "presetEditor.validation.command.invalidTemplatePlaceholders",
        messageParams: { inputCount, outputCount },
      });
    }
  }

  const encoderCapability = getEncoderCapability(state.video.encoder);
  const qualityValue = state.video.qualityValue;
  if (
    encoderCapability &&
    typeof qualityValue === "number" &&
    Number.isFinite(qualityValue) &&
    (qualityValue < encoderCapability.qualityRange.min || qualityValue > encoderCapability.qualityRange.max)
  ) {
    issues.push({
      level: "error",
      group: "video",
      field: "quality",
      messageKey: "presetEditor.validation.video.qualityOutOfRange",
      messageParams: {
        value: qualityValue,
        min: encoderCapability.qualityRange.min,
        max: encoderCapability.qualityRange.max,
      },
    });
  }

  for (const [field, label, value] of [
    ["gop", "gopSize", state.video.gopSize],
    ["bf", "bf", state.video.bf],
    ["rcLookahead", "rcLookahead", state.video.rcLookahead],
  ] as const) {
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      issues.push({
        level: "error",
        group: "video",
        field,
        messageKey: "presetEditor.validation.video.integerFieldRequired",
        messageParams: { field: label, value },
      });
    }
  }

  const fps = state.filters.fps;
  if (fps != null && String(fps).trim().length > 0 && !parseFpsExpression(fps).ok) {
    issues.push({
      level: "error",
      group: "filters",
      field: "fps",
      messageKey: "presetEditor.validation.filters.invalidFps",
      messageParams: { value: fps },
    });
  }
};
