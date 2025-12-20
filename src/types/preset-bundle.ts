import type { FFmpegPreset } from "./ffmpeg";

export interface PresetBundle {
  schemaVersion: number;
  appVersion: string;
  exportedAtMs: number;
  presets: FFmpegPreset[];
}

export interface PresetBundleExportResult {
  path: string;
  schemaVersion: number;
  appVersion: string;
  exportedAtMs: number;
  presetCount: number;
}
