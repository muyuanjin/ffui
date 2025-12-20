export const parseSkippedJobReason = (params: {
  reason: string | undefined;
  jobType: string;
  t: (key: string, values?: Record<string, unknown>) => string;
}): string => {
  const reason = params.reason;
  if (!reason) return "";

  // Size < XXX MB (video)
  const sizeVideoMatch = reason.match(/^Size < (\d+)MB$/i);
  if (sizeVideoMatch) {
    return params.t("queue.skipReasons.sizeVideoTooSmall", { size: sizeVideoMatch[1] });
  }

  // Size < XXX KB (image/audio)
  const sizeKbMatch = reason.match(/^Size < (\d+)KB$/i);
  if (sizeKbMatch) {
    if (params.jobType === "image") {
      return params.t("queue.skipReasons.sizeImageTooSmall", { size: sizeKbMatch[1] });
    }
    return params.t("queue.skipReasons.sizeAudioTooSmall", { size: sizeKbMatch[1] });
  }

  // Codec is already XXX
  const codecMatch = reason.match(/^Codec is already (.+)$/i);
  if (codecMatch) {
    return params.t("queue.skipReasons.codecAlready", { codec: codecMatch[1].toUpperCase() });
  }

  if (reason.toLowerCase() === "already avif") {
    return params.t("queue.skipReasons.alreadyAvif");
  }

  if (reason.toLowerCase() === "existing .avif sibling") {
    return params.t("queue.skipReasons.existingAvifSibling");
  }

  // Low savings (XX.X%)
  const savingsMatch = reason.match(/^Low savings \((.+)\)$/i);
  if (savingsMatch) {
    return params.t("queue.skipReasons.lowSavings", { ratio: savingsMatch[1] });
  }

  if (reason.toLowerCase().includes("no matching preset")) {
    return params.t("queue.skipReasons.noMatchingPreset");
  }

  return reason;
};
