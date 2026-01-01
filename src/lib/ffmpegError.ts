export type ParsedFfmpegError =
  | {
      kind: "missing_encoder";
      encoder: string;
      presetId?: string;
      ffmpegPath?: string;
      raw: string;
    }
  | {
      kind: "missing_decoder";
      decoder: string;
      ffmpegPath?: string;
      raw: string;
    }
  | {
      kind: "missing_filter";
      filter: string;
      ffmpegPath?: string;
      raw: string;
    }
  | {
      kind: "missing_library";
      library: string;
      ffmpegPath?: string;
      raw: string;
    }
  | {
      kind: "input_not_found";
      ffmpegPath?: string;
      raw: string;
    }
  | {
      kind: "permission_denied";
      ffmpegPath?: string;
      raw: string;
    }
  | {
      kind: "unknown";
      ffmpegPath?: string;
      raw: string;
    };

const stripKnownPrefix = (raw: string) =>
  raw.replace(/^(\s*(测量失败|Measure failed|Transcode failed|Encode failed|Failed|Error)\s*[:：]\s*)+/gi, "").trim();

const extractFfmpegPath = (raw: string) =>
  raw.match(/ffmpeg=([^\n]+?\.exe)/i)?.[1]?.trim() ?? raw.match(/ffmpeg=([^\n\s]+)/i)?.[1]?.trim();

const extractPresetId = (raw: string) => raw.match(/preset '([^']+)'/i)?.[1]?.trim();

export const parseFfmpegError = (rawInput: unknown): ParsedFfmpegError => {
  const raw = String(rawInput ?? "").trim();
  const stripped = stripKnownPrefix(raw);
  const message = stripped || raw;
  const ffmpegPath = extractFfmpegPath(message);

  const presetId = extractPresetId(message);

  const encoder =
    message.match(/cannot use video encoder '([^']+)'/i)?.[1]?.trim() ??
    message.match(/Unknown encoder '([^']+)'/i)?.[1]?.trim();
  if (encoder && /(Unknown encoder|cannot use video encoder|encoder probe failed)/i.test(message)) {
    return { kind: "missing_encoder", encoder, presetId, ffmpegPath, raw: message };
  }

  const decoder = message.match(/Unknown decoder '([^']+)'/i)?.[1]?.trim();
  if (decoder) return { kind: "missing_decoder", decoder, ffmpegPath, raw: message };

  const filter =
    message.match(/No such filter: '([^']+)'/i)?.[1]?.trim() ??
    message.match(/(No such filter|Unknown filter): '([^']+)'/i)?.[2]?.trim();
  if (filter) return { kind: "missing_filter", filter, ffmpegPath, raw: message };

  const sharedLibrary =
    message.match(/Error while loading shared libraries:\s*([^\s:]+)\s*:/i)?.[1]?.trim() ??
    message.match(/Cannot load\s+([^\s]+)\s*/i)?.[1]?.trim() ??
    message.match(/could not load\s+([^\s]+)\s*/i)?.[1]?.trim();
  if (sharedLibrary) return { kind: "missing_library", library: sharedLibrary, ffmpegPath, raw: message };

  if (/No such file or directory/i.test(message)) return { kind: "input_not_found", ffmpegPath, raw: message };
  if (/Permission denied/i.test(message)) return { kind: "permission_denied", ffmpegPath, raw: message };

  return { kind: "unknown", ffmpegPath, raw: message };
};
