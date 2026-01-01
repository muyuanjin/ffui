export type VqMetric = "ssim" | "vmaf" | "fps";

export interface VqPoint {
  /** bitrate (kbps) */
  x: number;
  /** metric value */
  y: number;
}

export interface VqDataset {
  /** 1 = anime, 2 = scenery (as in vq_results) */
  set: number;
  metric: VqMetric;
  /** Dataset key suffix in vq_results_data.js, e.g. "x264_medium_crf" */
  key: string;
  /** Display label embedded in the original dataset object. */
  label: string;
  points: VqPoint[];
}

export interface VqResultsSnapshot {
  source: {
    homepageUrl: string;
    dataUrl: string;
    title: string | null;
    fetchedAtIso: string;
  };
  /**
   * Optional provenance list for merged snapshots.
   * Not required by predictors; provided for debugging/attribution.
   */
  sources?: Array<{
    id: string;
    path?: string;
    homepageUrl?: string;
    dataUrl?: string;
    title?: string | null;
    fetchedAtIso?: string;
  }>;
  datasets: VqDataset[];
}
