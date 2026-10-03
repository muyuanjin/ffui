import type { AppSettings } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

export const normalizeLoadedAppSettings = (settings: AppSettings): AppSettings => {
  const next: AppSettings = { ...settings };
  if (typeof next.locale === "string") {
    const normalized = next.locale.trim();
    next.locale = normalized.length > 0 ? normalized : undefined;
  }
  if (typeof next.vmafMeasureReferencePath === "string") {
    const normalized = next.vmafMeasureReferencePath.trim();
    next.vmafMeasureReferencePath = normalized.length > 0 ? normalized : undefined;
  }
  if (typeof next.uiFontFilePath === "string" && next.uiFontFilePath.trim().length > 0) {
    next.uiFontDownloadId = undefined;
    next.uiFontFamily = "system";
    if (!next.uiFontName || !next.uiFontName.trim()) next.uiFontName = "FFUI Imported";
  } else if (typeof next.uiFontDownloadId === "string" && next.uiFontDownloadId.trim().length > 0) {
    next.uiFontFilePath = undefined;
    next.uiFontFamily = "system";
  }
  const family = next.uiFontFamily;
  if ((family === "sans" || family === "mono") && !next.uiFontName && !next.uiFontDownloadId && !next.uiFontFilePath) {
    next.uiFontFamily = "system";
  }
  if (!next.queueOutputPolicy) next.queueOutputPolicy = { ...DEFAULT_OUTPUT_POLICY };
  if (next.batchCompressDefaults && !next.batchCompressDefaults.outputPolicy) {
    next.batchCompressDefaults = { ...next.batchCompressDefaults, outputPolicy: { ...DEFAULT_OUTPUT_POLICY } };
  }
  return next;
};
