import { invokeCommand } from "./invokeCommand";
import type { JobCompareSources } from "@/types";
import type { FallbackFrameQuality } from "./fallbackPreview";
import type { WireJobCompareSources } from "./generated/queue-contracts";
import { jobCompareSourcesFromWire } from "./queueContract";

export const getJobCompareSources = async (jobId: string): Promise<JobCompareSources | null> => {
  const normalized = jobId.trim();
  if (!normalized) return null;
  const wire = await invokeCommand<WireJobCompareSources | null>("get_job_compare_sources", {
    args: {
      jobId: normalized,
    },
  });
  return jobCompareSourcesFromWire(wire);
};

export const extractJobCompareFrame = async (args: {
  jobId: string;
  sourcePath: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return invokeCommand<string>("extract_job_compare_frame", {
    args: {
      jobId: args.jobId,
      sourcePath: args.sourcePath,
      positionSeconds: args.positionSeconds,
      durationSeconds: args.durationSeconds ?? null,
      quality: args.quality,
    },
  });
};

export const extractJobCompareOutputFrame = async (args: {
  jobId: string;
  positionSeconds: number;
  durationSeconds?: number | null;
  quality: FallbackFrameQuality;
}): Promise<string> => {
  return invokeCommand<string>("extract_job_compare_output_frame", {
    args: {
      jobId: args.jobId,
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
  return invokeCommand<string>("extract_job_compare_concat_frame", {
    args: {
      jobId: args.jobId,
      segmentPaths: args.segmentPaths,
      positionSeconds: args.positionSeconds,
      quality: args.quality,
    },
  });
};
