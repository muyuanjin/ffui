import type { ParsedMediaAnalysis, MediaFileInfo } from "@/lib/mediaInfo";

export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes == null || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds == null || seconds <= 0) return "-";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export const formatDateTime = (ms: number | null | undefined): string => {
  if (ms == null || ms <= 0) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "-";
  }
};

export const formatFrameRate = (fps: number | null | undefined): string => {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return "-";
  const rounded = Number(fps.toFixed(3));
  return `${rounded} fps`;
};

export const buildSummaryFields = (options: {
  analysis: ParsedMediaAnalysis | null;
  inspectedPath: string | null;
  fileName: string;
  humanType: string;
  fileInfo: MediaFileInfo | null;
  t: (key: string) => string | unknown;
}) => {
  const { analysis, inspectedPath, fileName, humanType, fileInfo, t } = options;
  const summary = analysis?.summary ?? null;
  const format = analysis?.format ?? null;
  const sizeFromFs = fileInfo?.sizeBytes ?? null;
  const sizeFromFormat = typeof format?.sizeMB === "number" ? format.sizeMB * 1024 * 1024 : null;

  return [
    {
      key: "filePath",
      label: t("media.fields.filePath.label"),
      tooltip: t("media.fields.filePath.tooltip"),
      value: fileInfo?.path || inspectedPath || "-",
    },
    {
      key: "fileName",
      label: t("media.fields.fileName.label"),
      tooltip: t("media.fields.fileName.tooltip"),
      value: fileName || "-",
    },
    {
      key: "fileType",
      label: t("media.fields.fileType.label"),
      tooltip: t("media.fields.fileType.tooltip"),
      value: humanType,
    },
    {
      key: "fileSize",
      label: t("media.fields.fileSize.label"),
      tooltip: t("media.fields.fileSize.tooltip"),
      value: formatBytes(sizeFromFs ?? sizeFromFormat),
    },
    {
      key: "createdAt",
      label: t("media.fields.createdAt.label"),
      tooltip: t("media.fields.createdAt.tooltip"),
      value: formatDateTime(fileInfo?.createdMs ?? null),
    },
    {
      key: "modifiedAt",
      label: t("media.fields.modifiedAt.label"),
      tooltip: t("media.fields.modifiedAt.tooltip"),
      value: formatDateTime(fileInfo?.modifiedMs ?? null),
    },
    {
      key: "accessedAt",
      label: t("media.fields.accessedAt.label"),
      tooltip: t("media.fields.accessedAt.tooltip"),
      value: formatDateTime(fileInfo?.accessedMs ?? null),
    },
    {
      key: "duration",
      label: t("media.fields.duration.label"),
      tooltip: t("media.fields.duration.tooltip"),
      value: formatDuration(summary?.durationSeconds ?? format?.durationSeconds ?? null),
    },
    {
      key: "resolution",
      label: t("media.fields.resolution.label"),
      tooltip: t("media.fields.resolution.tooltip"),
      value: summary?.width && summary.height ? `${summary.width}x${summary.height}` : "-",
    },
    {
      key: "frameRate",
      label: t("media.fields.frameRate.label"),
      tooltip: t("media.fields.frameRate.tooltip"),
      value: formatFrameRate(summary?.frameRate ?? null),
    },
    {
      key: "videoCodec",
      label: t("media.fields.videoCodec.label"),
      tooltip: t("media.fields.videoCodec.tooltip"),
      value: summary?.videoCodec || "-",
    },
    {
      key: "audioCodec",
      label: t("media.fields.audioCodec.label"),
      tooltip: t("media.fields.audioCodec.tooltip"),
      value: summary?.audioCodec || "-",
    },
  ];
};

export const buildFormatFields = (analysis: ParsedMediaAnalysis | null, t: (key: string) => string | unknown) => {
  const format = analysis?.format ?? null;
  const tags = format?.tags ?? {};
  const tagEntries = Object.entries(tags);

  return {
    basic: [
      {
        key: "formatName",
        label: t("media.fields.formatName.label"),
        tooltip: t("media.fields.formatName.tooltip"),
        value: format?.formatName || "-",
      },
      {
        key: "formatLongName",
        label: t("media.fields.formatLongName.label"),
        tooltip: t("media.fields.formatLongName.tooltip"),
        value: format?.formatLongName || "-",
      },
      {
        key: "bitRate",
        label: t("media.fields.bitRate.label"),
        tooltip: t("media.fields.bitRate.tooltip"),
        value: typeof format?.bitRateKbps === "number" ? `${Math.round(format.bitRateKbps)} kbps` : "-",
      },
    ],
    tags: tagEntries,
  } as const;
};

export const mapStreamsForDisplay = (analysis: ParsedMediaAnalysis | null) => {
  const streams = analysis?.streams ?? [];
  return streams.map((s, idx) => {
    const index = typeof s.index === "number" && Number.isFinite(s.index) ? s.index : idx;
    const type = s.codecType || "unknown";
    const isVideo = type === "video";
    const isAudio = type === "audio";

    return { raw: s, id: index, type, isVideo, isAudio };
  });
};
