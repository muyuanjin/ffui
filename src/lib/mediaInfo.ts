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

export interface MediaFileInfo {
  path?: string;
  exists?: boolean;
  isFile?: boolean;
  isDir?: boolean;
  sizeBytes?: number;
  createdMs?: number;
  modifiedMs?: number;
  accessedMs?: number;
}

export interface ParsedMediaAnalysis {
  summary: MediaInfo | null;
  format: MediaFormatSummary | null;
  streams: MediaStreamSummary[];
  file: MediaFileInfo | null;
  /** Raw parsed ffprobe JSON (including any additional sections or fields). */
  raw: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

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
  const entries = Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v !== "");
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
};

export const parseFfprobeJson = (output: string): ParsedMediaAnalysis => {
  let root: unknown;
  try {
    root = JSON.parse(output) as unknown;
  } catch {
    // Keep the API tolerant to unexpected stdout (e.g. error messages),
    // callers can surface a higher-level error separately.
    return {
      summary: null,
      format: null,
      streams: [],
      file: null,
      raw: null,
    };
  }

  const rootRecord = isRecord(root) ? root : null;
  const formatRaw = rootRecord && isRecord(rootRecord.format) ? rootRecord.format : null;
  const streamsRaw: unknown[] = rootRecord && Array.isArray(rootRecord.streams) ? rootRecord.streams : [];
  const fileRaw = rootRecord && isRecord(rootRecord.file) ? rootRecord.file : null;

  const format: MediaFormatSummary | null =
    formatRaw && typeof formatRaw === "object"
      ? (() => {
          const sizeBytes = parseInteger(formatRaw.size);
          const bitRate = parseInteger(formatRaw.bit_rate);
          const duration = parseNumber(formatRaw.duration);

          return {
            formatName: typeof formatRaw.format_name === "string" ? formatRaw.format_name : undefined,
            formatLongName: typeof formatRaw.format_long_name === "string" ? formatRaw.format_long_name : undefined,
            durationSeconds: duration,
            sizeMB: typeof sizeBytes === "number" ? sizeBytes / (1024 * 1024) : undefined,
            bitRateKbps: typeof bitRate === "number" ? bitRate / 1000 : undefined,
            tags: normalizeTags(formatRaw.tags),
          };
        })()
      : null;

  const videoStreamRaw = streamsRaw.find((s) => isRecord(s) && s.codec_type === "video") as
    | Record<string, unknown>
    | undefined;
  const audioStreamRaw = streamsRaw.find((s) => isRecord(s) && s.codec_type === "audio") as
    | Record<string, unknown>
    | undefined;

  const durationSeconds = parseNumber(formatRaw?.duration) ?? parseNumber(videoStreamRaw?.duration) ?? undefined;

  const sizeBytes = parseInteger(formatRaw?.size);
  const sizeMB = typeof sizeBytes === "number" ? sizeBytes / (1024 * 1024) : undefined;

  const width = typeof videoStreamRaw?.width === "number" ? (videoStreamRaw.width as number) : undefined;
  const height = typeof videoStreamRaw?.height === "number" ? (videoStreamRaw.height as number) : undefined;

  const frameRate = parseFrameRate(videoStreamRaw?.avg_frame_rate) ?? parseFrameRate(videoStreamRaw?.r_frame_rate);

  const videoCodec = typeof videoStreamRaw?.codec_name === "string" ? (videoStreamRaw.codec_name as string) : undefined;
  const audioCodec = typeof audioStreamRaw?.codec_name === "string" ? (audioStreamRaw.codec_name as string) : undefined;

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
    if (!isRecord(s)) return {};
    const stream = s;

    const index = typeof stream.index === "number" && Number.isFinite(stream.index) ? stream.index : undefined;
    const codecType = typeof stream.codec_type === "string" ? stream.codec_type : undefined;
    const codecName = typeof stream.codec_name === "string" ? stream.codec_name : undefined;
    const codecLongName = typeof stream.codec_long_name === "string" ? stream.codec_long_name : undefined;
    const widthVal = typeof stream.width === "number" && Number.isFinite(stream.width) ? stream.width : undefined;
    const heightVal = typeof stream.height === "number" && Number.isFinite(stream.height) ? stream.height : undefined;
    const frameRateVal = parseFrameRate(stream.avg_frame_rate) ?? parseFrameRate(stream.r_frame_rate);
    const sampleRateHz = parseInteger(stream.sample_rate);
    const channels = parseInteger(stream.channels);
    const channelLayout = typeof stream.channel_layout === "string" ? stream.channel_layout : undefined;
    const bitRate = parseInteger(stream.bit_rate);

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
      bitRateKbps: typeof bitRate === "number" ? bitRate / 1000 : undefined,
      tags: normalizeTags(stream.tags),
    };
  });
  const file: MediaFileInfo | null = fileRaw
    ? {
        path: typeof fileRaw.path === "string" && fileRaw.path !== "" ? fileRaw.path : undefined,
        exists: typeof fileRaw.exists === "boolean" ? fileRaw.exists : undefined,
        isFile: typeof fileRaw.isFile === "boolean" ? fileRaw.isFile : undefined,
        isDir: typeof fileRaw.isDir === "boolean" ? fileRaw.isDir : undefined,
        sizeBytes: parseInteger(fileRaw.sizeBytes),
        createdMs: parseInteger(fileRaw.createdMs),
        modifiedMs: parseInteger(fileRaw.modifiedMs),
        accessedMs: parseInteger(fileRaw.accessedMs),
      }
    : null;

  return {
    summary,
    format,
    streams,
    file,
    raw: root,
  };
};
