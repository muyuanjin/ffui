import type {
  AudioConfig,
  ContainerConfig,
  FilterConfig,
  GlobalConfig,
  HardwareConfig,
  InputTimelineConfig,
  MappingConfig,
  SubtitlesConfig,
  VideoConfig,
} from "@/types";

export type PresetEditorGroup =
  | "command"
  | "global"
  | "input"
  | "mapping"
  | "video"
  | "audio"
  | "filters"
  | "container"
  | "hardware";

export type PresetEditorIssueLevel = "error" | "warning";

export interface PresetEditorIssue {
  level: PresetEditorIssueLevel;
  group: PresetEditorGroup;
  /** Matches the `data-field` in command preview tokens when possible. */
  field?: string;
  messageKey: string;
  messageParams?: Record<string, unknown>;
  fixId?: string;
}

export interface PresetEditorFix {
  id: string;
  group: PresetEditorGroup;
  field?: string;
  labelKey: string;
  apply: (state: PresetEditorMutableState) => void;
}

export interface PresetEditorMutableState {
  global: GlobalConfig;
  input: InputTimelineConfig;
  mapping: MappingConfig;
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  subtitles: SubtitlesConfig;
  container: ContainerConfig;
  hardware: HardwareConfig;
  advancedEnabled: { value: boolean };
  ffmpegTemplate: { value: string };
}

export interface PresetEditorValidationSummary {
  issues: PresetEditorIssue[];
  fixes: PresetEditorFix[];
  byGroup: Record<PresetEditorGroup, { errors: number; warnings: number; fixes: PresetEditorFix[] }>;
}
