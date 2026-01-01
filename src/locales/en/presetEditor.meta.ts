export const fieldError = {
  fix: "Fix",
  invalidNumber: "Invalid number",
  requiredInteger: "Enter an integer",
  invalidInteger: "Invalid integer",
  minValue: "Minimum: {min}",
  maxValue: "Maximum: {max}",
} as const;

export const fieldMeta = {
  recommendedLabel: "Recommended",
  recommendedValue: "Recommended: {value}",
  rangeMinMax: "Range: {min}–{max}{unit}",
  rangeMinOnly: "Min: {min}{unit}",
  rangeMaxOnly: "Max: {max}{unit}",
  unitOnly: "Unit: {unit}",
} as const;

export const validation = {
  groupSummary: "{errors} errors · {warnings} warnings",
  fixGroup: "Apply fixes",
  details: "Details",
  issuesTitle: "Issues",
  fixesTitle: "Fixes",
  locate: "Locate",
  applyFix: "Fix",
  errorLabel: "Error",
  warningLabel: "Warning",
  command: {
    emptyTemplateButEnabled: "Custom command is enabled, but the template is empty.",
    fixDisableAdvanced: "Disable custom command",
  },
  mapping: {
    invalidMapIndex: "Invalid input index: {value} (must be ≥ -1).",
    fixMapIndexToAuto: "Set to Auto",
    invalidMetadataPair: "Invalid metadata entry: {value} (expected key=value).",
    fixMetadataAppendEquals: "Append '=' to make it key=",
    invalidDispositionMissingValue: "Invalid disposition rule: {value} (missing value).",
    fixDispositionAppendDefault: "Append 'default'",
  },
  input: {
    invalidTimeExpression: "Invalid time expression: {value}.",
    fixClearTimeExpression: "Clear this value",
    invalidStreamLoop: "Invalid loop count: {value} (must be an integer).",
    fixStreamLoopToInteger: "Convert to integer",
  },
  video: {
    maxrateBelowBitrate: "maxrate ({maxrate}k) must be ≥ bitrate ({bitrate}k).",
    fixMaxrateToBitrate: "Set maxrate = bitrate",
    bufsizeOutOfRange: "bufsize ({bufsize}k) is outside the suggested range: {min}k–{max}k.",
    fixBufsizeTo2xMaxrate: "Set bufsize = 2× maxrate",
  },
  audio: {
    invalidBitrate: "Invalid audio bitrate: {value} (must be > 0).",
    fixClearBitrate: "Clear bitrate",
    invalidSampleRate: "Invalid sample rate: {value} (must be > 0).",
    fixClearSampleRate: "Clear sample rate",
    invalidChannels: "Invalid channel count: {value} (must be > 0).",
    fixClearChannels: "Clear channels",
  },
  filters: {
    filterComplexWithVfAf: "filter_complex is set; vf/af may still be generated and could be unexpected.",
  },
} as const;
