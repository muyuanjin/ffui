import type { AudioConfig, FilterConfig, GlobalConfig, InputTimelineConfig, MappingConfig, VideoConfig } from "@/types";

export interface StructuredParseState {
  reasons: string[];
  global: GlobalConfig;
  input: InputTimelineConfig;
  mapping: MappingConfig;
  filters: FilterConfig;
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
