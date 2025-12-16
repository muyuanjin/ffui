import { invoke } from "@tauri-apps/api/core";
import type { JobCompareSources } from "@/types";
import type { FallbackFrameQuality } from "./fallbackPreview";

export const getJobCompareSources = async (jobId: string): Promise<JobCompareSources | null> => {
  const normalized = jobId.trim();
  if (!normalized) return null;
  return invoke<JobCompareSources | null>("get_job_compare_sources", {
    args: {
      jobId: normalized,
    },
  });
};

export const extractJobCompareFrame = async (args: {
  jobId: string;
  sourcePath: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return invoke<string>("extract_job_compare_frame", {
    args: {
      jobId: args.jobId,
      sourcePath: args.sourcePath,
      positionSeconds: args.positionSeconds,
      durationSeconds: args.durationSeconds ?? null,
      quality: args.quality,
    },
  });
};

export const extractJobCompareConcatFrame = async (args: {
  jobId: string;
  segmentPaths: string[];
  positionSeconds: number;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return invoke<string>("extract_job_compare_concat_frame", {
    args: {
      jobId: args.jobId,
      segmentPaths: args.segmentPaths,
      positionSeconds: args.positionSeconds,
      quality: args.quality,
    },
  });
};
