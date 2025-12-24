import type { CSSProperties } from "vue";

export type CompareMode = "side-by-side" | "wipe" | "blink";

export interface CompareMediaSourceProps {
  usingFrameCompare: boolean;
  inputVideoUrl: string | null;
  outputVideoUrl: string | null;
  inputFrameUrl: string | null;
  inputFrameLoading: boolean;
  inputFrameError: string | null;
  inputFrameQuality?: "low" | "high" | null;
  outputFrameUrl: string | null;
  outputFrameLoading: boolean;
  outputFrameError: string | null;
  outputFrameQuality?: "low" | "high" | null;
}

export interface CompareViewportProps extends CompareMediaSourceProps {
  open: boolean;
  mode: CompareMode;
  loadingSources: boolean;
  sourcesError: string | null;
}

export interface CompareMediaStageProps extends CompareMediaSourceProps {
  mode: CompareMode;
  transformStyle: CSSProperties;
  wipePercent: number;
  blinkShowInput: boolean;
}
