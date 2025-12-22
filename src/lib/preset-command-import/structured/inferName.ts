import { stripQuotes } from "../utils";

export const inferNameFromTokens = (tokensWithProgram: string[]): string => {
  const tokens = tokensWithProgram.slice(1);
  const getValueAfter = (flag: string): string | null => {
    const idx = tokens.findIndex((t) => stripQuotes(t) === flag);
    if (idx < 0) return null;
    const value = tokens[idx + 1];
    if (!value) return null;
    if (stripQuotes(value).startsWith("-")) return null;
    return stripQuotes(value);
  };

  const videoCodec = getValueAfter("-c:v");
  if (videoCodec === "copy") return "copy (remux)";

  const encoder = videoCodec ?? "ffmpeg";
  const crf = getValueAfter("-crf");
  const cq = getValueAfter("-cq");
  const rc = getValueAfter("-rc");
  const qp = getValueAfter("-qp");
  const preset = getValueAfter("-preset");

  let rcLabel = "";
  if (crf != null) {
    rcLabel = `CRF ${crf}`;
  } else if (cq != null) {
    rcLabel = `CQ ${cq}`;
  } else if (rc === "constqp" && qp != null) {
    rcLabel = `CQ ${qp}`;
  }

  const parts: string[] = [];
  parts.push(encoder);
  if (rcLabel) parts.push(rcLabel);
  if (preset && /^p\\d+$/i.test(preset)) parts.push(preset);

  const audioCodec = getValueAfter("-c:a");
  const audioBitrate = getValueAfter("-b:a");
  if (audioCodec === "aac" && audioBitrate) {
    parts.push(`+ AAC ${audioBitrate}`);
  }

  return parts.join(" ").trim();
};
