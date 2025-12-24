import type { AudioConfig, FilterConfig, GlobalConfig, InputTimelineConfig, MappingConfig, VideoConfig } from "@/types";

export type StructuredFiltersState = FilterConfig & {
  /** Internal marker used while parsing "-sn". */
  __subtitleDrop?: boolean;
  /** Internal marker for burn-in subtitle filter parsed from "-vf subtitles=...". */
  __burnInFilter?: string;
};

export interface StructuredParseState {
  reasons: string[];
  global: GlobalConfig;
  input: InputTimelineConfig;
  mapping: MappingConfig;
  filters: StructuredFiltersState;
  video: Partial<VideoConfig>;
  audio: Partial<AudioConfig>;
  maps: string[];
  metadata: string[];
  dispositions: string[];
  sawMap: boolean;
  beforeInput: boolean;
  sawInput: boolean;
}

export type TokenHandlerResult = { consumed: number; stop?: boolean };
