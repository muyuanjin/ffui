export type PresetTemplateValidationOutcome =
  | "ok"
  | "failed"
  | "timedOut"
  | "skippedToolUnavailable"
  | "templateInvalid";

export interface PresetTemplateValidationResult {
  outcome: PresetTemplateValidationOutcome;
  ffmpegPath?: string;
  ffmpegSource?: string;
  exitCode?: number;
  stderrSummary?: string;
  message?: string;
}
