import type { FFmpegPreset } from "@/types";

export interface ImportCommandEligibility {
  editable: boolean;
  custom: boolean;
}

export interface ImportCommandLineAnalysis {
  raw: string;
  trimmed: string;
  normalizedTemplate: string;
  /** Args-only template suitable for backend execution (no leading `ffmpeg`). */
  argsOnlyTemplate: string | null;
  eligibility: ImportCommandEligibility;
  reasons: string[];
  suggestedName: string;
  structuredPreset?: FFmpegPreset;
}
