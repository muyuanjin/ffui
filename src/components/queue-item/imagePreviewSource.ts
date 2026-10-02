import type { TranscodeJob } from "@/types";

export const imagePreviewSource = (
  job: Pick<TranscodeJob, "inputPath" | "outputPath" | "status" | "executionMode">,
): string | null => {
  if (job.status === "completed" && job.executionMode !== "transparent") {
    return job.outputPath || job.inputPath || null;
  }
  return job.inputPath || (job.status === "completed" ? job.outputPath || null : null);
};
