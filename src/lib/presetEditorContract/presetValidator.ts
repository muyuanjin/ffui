import type {
  PresetEditorFix,
  PresetEditorGroup,
  PresetEditorIssue,
  PresetEditorMutableState,
  PresetEditorValidationSummary,
} from "./presetValidatorTypes";

export type {
  PresetEditorFix,
  PresetEditorGroup,
  PresetEditorIssue,
  PresetEditorIssueLevel,
  PresetEditorMutableState,
  PresetEditorValidationSummary,
} from "./presetValidatorTypes";

export type { PresetValidationResult } from "./presetValidatorPreset";
export { quarantinePresetIfInvalid, validatePresetForEditor } from "./presetValidatorPreset";

const emptyGroupSummary = (): Record<
  PresetEditorGroup,
  { errors: number; warnings: number; fixes: PresetEditorFix[] }
> =>
  ({
    command: { errors: 0, warnings: 0, fixes: [] },
    global: { errors: 0, warnings: 0, fixes: [] },
    input: { errors: 0, warnings: 0, fixes: [] },
    mapping: { errors: 0, warnings: 0, fixes: [] },
    video: { errors: 0, warnings: 0, fixes: [] },
    audio: { errors: 0, warnings: 0, fixes: [] },
    filters: { errors: 0, warnings: 0, fixes: [] },
    container: { errors: 0, warnings: 0, fixes: [] },
    hardware: { errors: 0, warnings: 0, fixes: [] },
  }) satisfies PresetEditorValidationSummary["byGroup"];

export const validatePresetEditorState = (state: PresetEditorMutableState): PresetEditorValidationSummary => {
  const issues: PresetEditorIssue[] = [];
  const fixes: PresetEditorFix[] = [];

  const isValidTimeExpression = (raw: string, opts: { allowNegative: boolean }) => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return true;
    if (!opts.allowNegative && trimmed.startsWith("-")) return false;
    const s = opts.allowNegative ? trimmed.replace(/^[+-]/, "") : trimmed.replace(/^\+/, "");
    if (!s) return false;
    if (/^\d+(?:\.\d+)?$/.test(s)) return true; // seconds
    if (/^\d+:[0-5]\d(?:\.\d+)?$/.test(s)) return true; // mm:ss
    if (/^\d+:[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(s)) return true; // hh:mm:ss
    return false;
  };

  // --- command/template consistency ---
  if (state.advancedEnabled.value && state.ffmpegTemplate.value.trim().length === 0) {
    const id = "fix-disable-advanced-with-empty-template";
    issues.push({
      level: "warning",
      group: "command",
      field: "template",
      messageKey: "presetEditor.validation.command.emptyTemplateButEnabled",
      fixId: id,
    });
    fixes.push({
      id,
      group: "command",
      field: "template",
      labelKey: "presetEditor.validation.command.fixDisableAdvanced",
      apply: (s) => {
        s.advancedEnabled.value = false;
      },
    });
  }

  // --- input/timeline: time expressions ---
  const seekPosition = state.input.seekPosition;
  if (
    typeof seekPosition === "string" &&
    seekPosition.trim().length > 0 &&
    !isValidTimeExpression(seekPosition, { allowNegative: false })
  ) {
    const id = "fix-input-clear-seek-position";
    issues.push({
      level: "error",
      group: "input",
      field: "timeline",
      messageKey: "presetEditor.validation.input.invalidTimeExpression",
      messageParams: { value: seekPosition },
      fixId: id,
    });
    fixes.push({
      id,
      group: "input",
      field: "timeline",
      labelKey: "presetEditor.validation.input.fixClearTimeExpression",
      apply: (s) => {
        s.input.seekPosition = undefined;
      },
    });
  }

  const duration = state.input.duration;
  if (
    typeof duration === "string" &&
    duration.trim().length > 0 &&
    !isValidTimeExpression(duration, { allowNegative: false })
  ) {
    const id = "fix-input-clear-duration";
    issues.push({
      level: "error",
      group: "input",
      field: "timeline",
      messageKey: "presetEditor.validation.input.invalidTimeExpression",
      messageParams: { value: duration },
      fixId: id,
    });
    fixes.push({
      id,
      group: "input",
      field: "timeline",
      labelKey: "presetEditor.validation.input.fixClearTimeExpression",
      apply: (s) => {
        s.input.duration = undefined;
      },
    });
  }

  const inputTimeOffset = state.input.inputTimeOffset;
  if (
    typeof inputTimeOffset === "string" &&
    inputTimeOffset.trim().length > 0 &&
    !isValidTimeExpression(inputTimeOffset, { allowNegative: true })
  ) {
    const id = "fix-input-clear-itsoffset";
    issues.push({
      level: "error",
      group: "input",
      field: "inputAdvanced",
      messageKey: "presetEditor.validation.input.invalidTimeExpression",
      messageParams: { value: inputTimeOffset },
      fixId: id,
    });
    fixes.push({
      id,
      group: "input",
      field: "inputAdvanced",
      labelKey: "presetEditor.validation.input.fixClearTimeExpression",
      apply: (s) => {
        s.input.inputTimeOffset = undefined;
      },
    });
  }

  const streamLoop = state.input.streamLoop;
  if (typeof streamLoop === "number" && Number.isFinite(streamLoop) && !Number.isInteger(streamLoop)) {
    const id = "fix-input-stream-loop-to-integer";
    issues.push({
      level: "error",
      group: "input",
      field: "inputAdvanced",
      messageKey: "presetEditor.validation.input.invalidStreamLoop",
      messageParams: { value: streamLoop },
      fixId: id,
    });
    fixes.push({
      id,
      group: "input",
      field: "inputAdvanced",
      labelKey: "presetEditor.validation.input.fixStreamLoopToInteger",
      apply: (s) => {
        if (!Number.isFinite(s.input.streamLoop as any)) return;
        s.input.streamLoop = Math.trunc(s.input.streamLoop as number);
      },
    });
  }
  if (
    typeof streamLoop === "number" &&
    Number.isFinite(streamLoop) &&
    Number.isInteger(streamLoop) &&
    streamLoop < -1
  ) {
    const id = "fix-input-clear-stream-loop";
    issues.push({
      level: "error",
      group: "input",
      field: "inputAdvanced",
      messageKey: "presetEditor.validation.input.invalidStreamLoop",
      messageParams: { value: streamLoop },
      fixId: id,
    });
    fixes.push({
      id,
      group: "input",
      field: "inputAdvanced",
      labelKey: "presetEditor.validation.input.fixClearTimeExpression",
      apply: (s) => {
        s.input.streamLoop = undefined;
      },
    });
  }

  // --- mapping: map_metadata / map_chapters ---
  const mapMetadata = state.mapping.mapMetadataFromInputFileIndex;
  if (typeof mapMetadata === "number" && Number.isFinite(mapMetadata) && mapMetadata < -1) {
    const id = "fix-mapping-map-metadata-to-auto";
    issues.push({
      level: "error",
      group: "mapping",
      field: "mapMetadata",
      messageKey: "presetEditor.validation.mapping.invalidMapIndex",
      messageParams: { value: mapMetadata },
      fixId: id,
    });
    fixes.push({
      id,
      group: "mapping",
      field: "mapMetadata",
      labelKey: "presetEditor.validation.mapping.fixMapIndexToAuto",
      apply: (s) => {
        s.mapping.mapMetadataFromInputFileIndex = undefined;
      },
    });
  }

  const mapChapters = state.mapping.mapChaptersFromInputFileIndex;
  if (typeof mapChapters === "number" && Number.isFinite(mapChapters) && mapChapters < -1) {
    const id = "fix-mapping-map-chapters-to-auto";
    issues.push({
      level: "error",
      group: "mapping",
      field: "mapChapters",
      messageKey: "presetEditor.validation.mapping.invalidMapIndex",
      messageParams: { value: mapChapters },
      fixId: id,
    });
    fixes.push({
      id,
      group: "mapping",
      field: "mapChapters",
      labelKey: "presetEditor.validation.mapping.fixMapIndexToAuto",
      apply: (s) => {
        s.mapping.mapChaptersFromInputFileIndex = undefined;
      },
    });
  }

  // --- mapping: metadata key=value pairs ---
  const metadata = state.mapping.metadata;
  if (Array.isArray(metadata)) {
    for (const kv of metadata) {
      const trimmed = String(kv ?? "").trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) {
        const id = `fix-mapping-metadata-append-equals-${issues.length}`;
        issues.push({
          level: "error",
          group: "mapping",
          field: "metadata",
          messageKey: "presetEditor.validation.mapping.invalidMetadataPair",
          messageParams: { value: trimmed },
          fixId: id,
        });
        fixes.push({
          id,
          group: "mapping",
          field: "metadata",
          labelKey: "presetEditor.validation.mapping.fixMetadataAppendEquals",
          apply: (s) => {
            const list = s.mapping.metadata;
            if (!Array.isArray(list)) return;
            const index = list.findIndex((v) => String(v ?? "").trim() === trimmed);
            if (index < 0) return;
            list[index] = `${trimmed}=`;
          },
        });
      } else if (idx === 0) {
        issues.push({
          level: "error",
          group: "mapping",
          field: "metadata",
          messageKey: "presetEditor.validation.mapping.invalidMetadataPair",
          messageParams: { value: trimmed },
        });
      }
    }
  }

  // --- mapping: dispositions must include a value when using a stream specifier ---
  const dispositions = state.mapping.dispositions;
  if (Array.isArray(dispositions)) {
    for (const raw of dispositions) {
      const trimmed = String(raw ?? "").trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/).filter((p) => p.length > 0);
      if (parts.length !== 1) continue;
      const spec = parts[0] ?? "";
      const normalized = spec.replace(/^\d+:/, "");
      if (/^(v|a|s|d)(?::\d+)?$/.test(normalized)) {
        const id = `fix-mapping-disposition-append-default-${normalized}`;
        issues.push({
          level: "error",
          group: "mapping",
          field: "disposition",
          messageKey: "presetEditor.validation.mapping.invalidDispositionMissingValue",
          messageParams: { value: trimmed },
          fixId: id,
        });
        fixes.push({
          id,
          group: "mapping",
          field: "disposition",
          labelKey: "presetEditor.validation.mapping.fixDispositionAppendDefault",
          apply: (s) => {
            const list = s.mapping.dispositions;
            if (!Array.isArray(list)) return;
            const idx = list.findIndex((v) => String(v ?? "").trim() === trimmed);
            if (idx < 0) return;
            list[idx] = `${trimmed} default`;
          },
        });
      }
    }
  }

  // --- video: bitrate/VBV constraints ---
  const rateControl = String(state.video.rateControl ?? "")
    .trim()
    .toLowerCase();
  const isBitrateMode = rateControl === "cbr" || rateControl === "vbr";
  const bitrate =
    typeof state.video.bitrateKbps === "number" &&
    Number.isFinite(state.video.bitrateKbps) &&
    state.video.bitrateKbps > 0
      ? Math.floor(state.video.bitrateKbps)
      : undefined;
  const maxrate =
    typeof state.video.maxBitrateKbps === "number" &&
    Number.isFinite(state.video.maxBitrateKbps) &&
    state.video.maxBitrateKbps > 0
      ? Math.floor(state.video.maxBitrateKbps)
      : undefined;
  const bufsize =
    typeof state.video.bufferSizeKbits === "number" &&
    Number.isFinite(state.video.bufferSizeKbits) &&
    state.video.bufferSizeKbits > 0
      ? Math.floor(state.video.bufferSizeKbits)
      : undefined;

  if (isBitrateMode && bitrate && maxrate && maxrate < bitrate) {
    const id = "fix-video-maxrate-to-bitrate";
    issues.push({
      level: "error",
      group: "video",
      field: "maxrate",
      messageKey: "presetEditor.validation.video.maxrateBelowBitrate",
      messageParams: { bitrate, maxrate },
      fixId: id,
    });
    fixes.push({
      id,
      group: "video",
      field: "maxrate",
      labelKey: "presetEditor.validation.video.fixMaxrateToBitrate",
      apply: (s) => {
        s.video.maxBitrateKbps = bitrate;
      },
    });
  }

  if (isBitrateMode && maxrate && bufsize) {
    const lower = maxrate;
    const upper = maxrate * 3;
    if (bufsize < lower || bufsize > upper) {
      const id = "fix-video-bufsize-to-2x-maxrate";
      issues.push({
        level: "warning",
        group: "video",
        field: "bufsize",
        messageKey: "presetEditor.validation.video.bufsizeOutOfRange",
        messageParams: { bufsize, min: lower, max: upper },
        fixId: id,
      });
      fixes.push({
        id,
        group: "video",
        field: "bufsize",
        labelKey: "presetEditor.validation.video.fixBufsizeTo2xMaxrate",
        apply: (s) => {
          s.video.bufferSizeKbits = maxrate * 2;
        },
      });
    }
  }

  // --- audio: invalid numeric params can produce invalid ffmpeg flags ---
  if (state.audio.codec === "aac") {
    const bitrate = state.audio.bitrate;
    if (typeof bitrate === "number" && Number.isFinite(bitrate) && bitrate <= 0) {
      const id = "fix-audio-clear-bitrate";
      issues.push({
        level: "error",
        group: "audio",
        field: "params",
        messageKey: "presetEditor.validation.audio.invalidBitrate",
        messageParams: { value: bitrate },
        fixId: id,
      });
      fixes.push({
        id,
        group: "audio",
        field: "params",
        labelKey: "presetEditor.validation.audio.fixClearBitrate",
        apply: (s) => {
          s.audio.bitrate = undefined;
        },
      });
    }
    const sampleRateHz = state.audio.sampleRateHz;
    if (typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz) && sampleRateHz <= 0) {
      const id = "fix-audio-clear-sample-rate";
      issues.push({
        level: "error",
        group: "audio",
        field: "params",
        messageKey: "presetEditor.validation.audio.invalidSampleRate",
        messageParams: { value: sampleRateHz },
        fixId: id,
      });
      fixes.push({
        id,
        group: "audio",
        field: "params",
        labelKey: "presetEditor.validation.audio.fixClearSampleRate",
        apply: (s) => {
          s.audio.sampleRateHz = undefined;
        },
      });
    }
    const channels = state.audio.channels;
    if (typeof channels === "number" && Number.isFinite(channels) && channels <= 0) {
      const id = "fix-audio-clear-channels";
      issues.push({
        level: "error",
        group: "audio",
        field: "params",
        messageKey: "presetEditor.validation.audio.invalidChannels",
        messageParams: { value: channels },
        fixId: id,
      });
      fixes.push({
        id,
        group: "audio",
        field: "params",
        labelKey: "presetEditor.validation.audio.fixClearChannels",
        apply: (s) => {
          s.audio.channels = undefined;
        },
      });
    }
  }

  // --- filters: complex + vf/af can be surprising (warning only) ---
  const hasFilterComplex =
    typeof state.filters.filterComplex === "string" && state.filters.filterComplex.trim().length > 0;
  const hasVf =
    (typeof state.filters.scale === "string" && state.filters.scale.trim().length > 0) ||
    (typeof state.filters.crop === "string" && state.filters.crop.trim().length > 0) ||
    (typeof state.filters.fps === "number" && Number.isFinite(state.filters.fps) && state.filters.fps > 0) ||
    (typeof state.filters.vfChain === "string" && state.filters.vfChain.trim().length > 0);
  const hasAf =
    (typeof state.filters.afChain === "string" && state.filters.afChain.trim().length > 0) ||
    (state.audio.loudnessProfile != null && state.audio.loudnessProfile !== "none");
  if (hasFilterComplex && (hasVf || hasAf)) {
    issues.push({
      level: "warning",
      group: "filters",
      field: "filterComplex",
      messageKey: "presetEditor.validation.filters.filterComplexWithVfAf",
    });
  }

  const byGroup = emptyGroupSummary();
  for (const issue of issues) {
    if (issue.level === "error") byGroup[issue.group].errors += 1;
    else byGroup[issue.group].warnings += 1;
  }
  for (const fix of fixes) {
    byGroup[fix.group].fixes.push(fix);
  }

  return { issues, fixes, byGroup };
};
