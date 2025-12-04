import type { MediaInfo } from "@/types";

export interface MediaFormatSummary {
  formatName?: string;
  formatLongName?: string;
  durationSeconds?: number;
  sizeMB?: number;
  bitRateKbps?: number;
  tags?: Record<string, string>;
}

export interface MediaStreamSummary {
  index?: number;
  codecType?: string;
  codecName?: string;
  codecLongName?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  sampleRateHz?: number;
  channels?: number;
  channelLayout?: string;
  bitRateKbps?: number;
  tags?: Record<string, string>;
}

export interface ParsedMediaAnalysis {
  summary: MediaInfo | null;
  format: MediaFormatSummary | null;
  streams: MediaStreamSummary[];
}

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseInteger = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseFrameRate = (token: unknown): number | undefined => {
  if (typeof token !== "string") return undefined;
  const trimmed = token.trim();
  if (!trimmed) return undefined;

  const fractionIndex = trimmed.indexOf("/");
  if (fractionIndex > 0) {
    const num = Number.parseFloat(trimmed.slice(0, fractionIndex));
    const den = Number.parseFloat(trimmed.slice(fractionIndex + 1));
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) {
      return undefined;
    }
    return num / den;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeTags = (raw: unknown): Record<string, string> | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([, v]) => typeof v === "string" && v !== "",
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
};

export const parseFfprobeJson = (output: string): ParsedMediaAnalysis => {
  let root: any;
  try {
    root = JSON.parse(output);
  } catch {
    // Keep the API tolerant to unexpected stdout (e.g. error messages),
    // callers can surface a higher-level error separately.
    return {
      summary: null,
      format: null,
      streams: [],
    };
  }

  const formatRaw = root && typeof root === "object" ? root.format : null;
  const streamsRaw: any[] = Array.isArray(root?.streams) ? root.streams : [];

  const format: MediaFormatSummary | null =
    formatRaw && typeof formatRaw === "object"
      ? (() => {
          const sizeBytes = parseInteger(formatRaw.size);
          const bitRate = parseInteger(formatRaw.bit_rate);
          const duration = parseNumber(formatRaw.duration);

          return {
            formatName:
              typeof formatRaw.format_name === "string"
                ? formatRaw.format_name
                : undefined,
            formatLongName:
              typeof formatRaw.format_long_name === "string"
                ? formatRaw.format_long_name
                : undefined,
            durationSeconds: duration,
            sizeMB:
              typeof sizeBytes === "number"
                ? sizeBytes / (1024 * 1024)
                : undefined,
            bitRateKbps:
              typeof bitRate === "number" ? bitRate / 1000 : undefined,
            tags: normalizeTags(formatRaw.tags),
          };
        })()
      : null;

  const videoStreamRaw =
    streamsRaw.find((s) => s && s.codec_type === "video") ?? null;
  const audioStreamRaw =
    streamsRaw.find((s) => s && s.codec_type === "audio") ?? null;

  const durationSeconds =
    parseNumber(formatRaw?.duration) ??
    parseNumber(videoStreamRaw?.duration) ??
    undefined;

  const sizeBytes = parseInteger(formatRaw?.size);
  const sizeMB =
    typeof sizeBytes === "number" ? sizeBytes / (1024 * 1024) : undefined;

  const width =
    typeof videoStreamRaw?.width === "number"
      ? (videoStreamRaw.width as number)
      : undefined;
  const height =
    typeof videoStreamRaw?.height === "number"
      ? (videoStreamRaw.height as number)
      : undefined;

  const frameRate =
    parseFrameRate(videoStreamRaw?.avg_frame_rate) ??
    parseFrameRate(videoStreamRaw?.r_frame_rate);

  const videoCodec =
    typeof videoStreamRaw?.codec_name === "string"
      ? (videoStreamRaw.codec_name as string)
      : undefined;
  const audioCodec =
    typeof audioStreamRaw?.codec_name === "string"
      ? (audioStreamRaw.codec_name as string)
      : undefined;

  const summary: MediaInfo = {
    durationSeconds: durationSeconds ?? undefined,
    width,
    height,
    frameRate: frameRate ?? undefined,
    videoCodec,
    audioCodec,
    sizeMB: sizeMB ?? undefined,
  };

  const streams: MediaStreamSummary[] = streamsRaw.map((s) => {
    if (!s || typeof s !== "object") return {};

    const index =
      typeof s.index === "number" && Number.isFinite(s.index)
        ? (s.index as number)
        : undefined;
    const codecType =
      typeof s.codec_type === "string" ? (s.codec_type as string) : undefined;
    const codecName =
      typeof s.codec_name === "string" ? (s.codec_name as string) : undefined;
    const codecLongName =
      typeof s.codec_long_name === "string"
        ? (s.codec_long_name as string)
        : undefined;
    const widthVal =
      typeof s.width === "number" && Number.isFinite(s.width)
        ? (s.width as number)
        : undefined;
    const heightVal =
      typeof s.height === "number" && Number.isFinite(s.height)
        ? (s.height as number)
        : undefined;
    const frameRateVal =
      parseFrameRate(s.avg_frame_rate) ?? parseFrameRate(s.r_frame_rate);
    const sampleRateHz = parseInteger(s.sample_rate);
    const channels = parseInteger(s.channels);
    const channelLayout =
      typeof s.channel_layout === "string"
        ? (s.channel_layout as string)
        : undefined;
    const bitRate = parseInteger(s.bit_rate);

    return {
      index,
      codecType,
      codecName,
      codecLongName,
      width: widthVal,
      height: heightVal,
      frameRate: frameRateVal,
      sampleRateHz,
      channels,
      channelLayout,
      bitRateKbps:
        typeof bitRate === "number" ? bitRate / 1000 : undefined,
      tags: normalizeTags(s.tags),
    };
  });

  return {
    summary,
    format,
    streams,
  };
};

