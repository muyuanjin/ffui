import type { AudioCodecType, FFmpegPreset, RateControlMode, VideoConfig } from "@/types";
import type { ImportCommandLineAnalysis } from "./types";
import { normalizeLineToTemplateTokens } from "./templateTokens";
import { splitCommandLine, stripQuotes } from "./utils";
import { inferNameFromTokens } from "./structured/inferName";
import { isKnownOption } from "./structured/knownOptions";
import { parseAudioCodecType, parseEncoderType } from "./structured/codecs";
import { createGetValueAfter } from "./structured/getValueAfter";
import { tryParseStructuredPreset } from "./structured/parseStructuredPreset";

export const analyzeImportCommandLine = (raw: string): ImportCommandLineAnalysis => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return {
      raw,
      trimmed: "",
      normalizedTemplate: "",
      argsOnlyTemplate: null,
      eligibility: { editable: false, custom: false },
      reasons: ["空行"],
      suggestedName: "",
    };
  }

  const { tokensWithProgram, argsOnlyTokens, reasons } = normalizeLineToTemplateTokens(trimmed);
  const normalizedTemplate = tokensWithProgram.join(" ");
  const argsOnlyTemplate = argsOnlyTokens ? argsOnlyTokens.join(" ") : null;

  const suggestedName = tokensWithProgram.length > 0 ? inferNameFromTokens(tokensWithProgram) : "";

  const custom = !!argsOnlyTemplate && reasons.length === 0;

  let editable = false;
  let structuredPreset: FFmpegPreset | undefined;
  const structuredAttempt = custom ? tryParseStructuredPreset(tokensWithProgram) : { reasons: ["无法形成可执行模板"] };
  if (structuredAttempt.preset && structuredAttempt.reasons.length === 0) {
    editable = true;
    structuredPreset = structuredAttempt.preset;
  } else if (structuredAttempt.reasons.length > 0 && custom) {
    for (const r of structuredAttempt.reasons) reasons.push(r);
  }

  const unknownOptions = splitCommandLine(trimmed).filter((t) => {
    const raw = stripQuotes(t);
    if (!raw.startsWith("-")) return false;
    const looksLikeDashedValue = /^-[0-9.]/.test(raw);
    if (looksLikeDashedValue) return false;
    return !isKnownOption(t);
  });
  if (unknownOptions.length > 0 && custom) {
    editable = false;
  }

  return {
    raw,
    trimmed,
    normalizedTemplate,
    argsOnlyTemplate,
    eligibility: { editable, custom },
    reasons,
    suggestedName,
    structuredPreset,
  };
};

export const createCustomTemplatePresetFromAnalysis = (analysis: ImportCommandLineAnalysis): FFmpegPreset | null => {
  if (!analysis.eligibility.custom || !analysis.argsOnlyTemplate) return null;
  const suggested = analysis.suggestedName?.trim() || "Imported Command";
  const tokens = splitCommandLine(analysis.normalizedTemplate);
  const getValueAfter = createGetValueAfter(tokens);

  const encoder = (getValueAfter("-c:v") as VideoConfig["encoder"]) || "libx264";
  const audioCodec = (getValueAfter("-c:a") as AudioCodecType) || "copy";
  const crf = getValueAfter("-crf");
  const cq = getValueAfter("-cq");
  const qp = getValueAfter("-qp");
  const rc = getValueAfter("-rc");
  const preset = getValueAfter("-preset") || "medium";

  let rateControl: RateControlMode = "crf";
  let qualityValue = 23;
  if (crf != null) {
    rateControl = "crf";
    qualityValue = Number(crf);
  } else if (cq != null) {
    rateControl = "cq";
    qualityValue = Number(cq);
  } else if (rc === "constqp" && qp != null) {
    rateControl = "constqp";
    qualityValue = Number(qp);
  }

  return {
    id: "import-temp",
    name: suggested,
    description: "",
    video: {
      encoder: parseEncoderType(encoder) ?? "libx264",
      rateControl,
      qualityValue: Number.isFinite(qualityValue) ? qualityValue : 23,
      preset,
    },
    audio: {
      codec: parseAudioCodecType(audioCodec) ?? "copy",
    },
    filters: {},
    stats: {
      usageCount: 0,
      totalInputSizeMB: 0,
      totalOutputSizeMB: 0,
      totalTimeSeconds: 0,
    },
    advancedEnabled: true,
    ffmpegTemplate: analysis.argsOnlyTemplate,
    isSmartPreset: false,
  };
};
