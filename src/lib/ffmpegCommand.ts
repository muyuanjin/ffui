import type {
  AudioConfig,
  ContainerConfig,
  FilterConfig,
  FFmpegPreset,
  GlobalConfig,
  HardwareConfig,
  InputTimelineConfig,
  MappingConfig,
  SubtitlesConfig,
  VideoConfig,
} from "@/types";

export type CommandTokenKind =
  | "program"
  | "option"
  | "path"
  | "encoder"
  | "placeholder"
  | "other"
  | "whitespace";

export interface CommandToken {
  text: string;
  kind: CommandTokenKind;
  /** High-level parameter group used for UI navigation (global/video/audio/...). */
  group?: string;
  /** Optional field identifier within the group (for future fine-grained mapping). */
  field?: string;
}

export interface TemplateParseResult {
  template: string;
  inputReplaced: boolean;
  outputReplaced: boolean;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripQuotes = (value: string): string =>
  value.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");

const classifyCommandToken = (segment: string, index: number): CommandTokenKind => {
  if (!segment.trim()) return "whitespace";

  const unquoted = stripQuotes(segment);
  const lower = unquoted.toLowerCase();

  if (unquoted === "INPUT" || unquoted === "OUTPUT") {
    return "placeholder";
  }

  if (index === 0 && (lower === "ffmpeg" || lower === "ffprobe")) {
    return "program";
  }

  if (unquoted.startsWith("-")) {
    return "option";
  }

  if (/[\\/]/.test(unquoted) || /\.(mp4|mkv|mov|avi|webm|m4v|m4a|mp3)$/i.test(unquoted)) {
    return "path";
  }

  if (/libx264|libx265|hevc_nvenc|h264_nvenc|libsvtav1|av1/i.test(lower)) {
    return "encoder";
  }

  return "other";
};

export const tokenizeFfmpegCommand = (
  command: string | undefined | null,
): CommandToken[] => {
  const raw = command ?? "";
  if (!raw) return [];

  const tokens: CommandToken[] = [];
  const regex = /(".*?"|'.*?'|\S+)/g;
  let lastIndex = 0;
  let logicalIndex = 0;

  let match: RegExpExecArray | null;
  // Walk through the command, preserving all whitespace segments so that
  // joining token.text later reconstructs the exact original string.
  while ((match = regex.exec(raw)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      tokens.push({ text: raw.slice(lastIndex, start), kind: "whitespace" });
    }
    const segment = match[0];
    tokens.push({
      text: segment,
      kind: classifyCommandToken(segment, logicalIndex),
    });
    lastIndex = start + segment.length;
    logicalIndex += 1;
  }

  if (lastIndex < raw.length) {
    tokens.push({ text: raw.slice(lastIndex), kind: "whitespace" });
  }

  return tokens;
};

const assignCommandTokenGroups = (tokens: CommandToken[]): CommandToken[] => {
  const result = tokens.map((t) => ({ ...t }));

  const mark = (index: number, group: string, field?: string) => {
    const token = result[index];
    if (!token) return;
    token.group = token.group ?? group;
    token.field = token.field ?? field;
  };

  const len = result.length;
  for (let i = 0; i < len; i += 1) {
    const token = result[i];
    if (token.kind !== "option") continue;
    const opt = stripQuotes(token.text).toLowerCase();

    let group: string | undefined;
    let field: string | undefined;

    // Global / command-level options.
    if (opt === "-progress") {
      group = "global";
      field = "progress";
    } else if (opt === "-nostdin") {
      group = "global";
      field = "nostdin";
    } else if (opt === "-y" || opt === "-n") {
      group = "global";
      field = "overwrite";
    } else if (opt === "-loglevel") {
      group = "global";
      field = "loglevel";
    } else if (opt === "-hide_banner") {
      group = "global";
      field = "hideBanner";
    } else if (opt === "-report") {
      group = "global";
      field = "report";
    }

    // Input / timeline.
    if (!group) {
      if (opt === "-ss" || opt === "-t" || opt === "-to") {
        group = "input";
        field = "timeline";
      } else if (opt === "-accurate_seek") {
        group = "input";
        field = "accurateSeek";
      } else if (opt === "-stream_loop" || opt === "-itsoffset") {
        group = "input";
        field = "inputAdvanced";
      }
    }

    // Mapping & metadata.
    if (!group) {
      if (opt === "-map") {
        group = "mapping";
        field = "map";
      } else if (opt === "-map_metadata" || opt === "-map_chapters") {
        group = "mapping";
        field = "mapMeta";
      } else if (opt === "-metadata") {
        group = "mapping";
        field = "metadata";
      } else if (opt === "-disposition") {
        group = "mapping";
        field = "disposition";
      } else if (opt === "-attach" || opt === "-dump_attachment") {
        group = "mapping";
        field = "attachments";
      }
    }

    // Video.
    if (!group) {
      if (opt === "-c:v" || opt === "-codec:v") {
        group = "video";
        field = "encoder";
      } else if (opt === "-crf" || opt === "-cq") {
        group = "video";
        field = "quality";
      } else if (opt === "-b:v" || opt === "-maxrate" || opt === "-bufsize" || opt === "-pass") {
        group = "video";
        field = "bitrate";
      } else if (opt === "-preset" || opt === "-tune" || opt === "-profile:v") {
        group = "video";
        field = "preset";
      } else if (opt === "-level" || opt === "-g" || opt === "-bf" || opt === "-pix_fmt") {
        group = "video";
        field = "advanced";
      }
    }

    // Audio.
    if (!group) {
      if (opt === "-c:a" || opt === "-codec:a") {
        group = "audio";
        field = "codec";
      } else if (opt === "-b:a" || opt === "-ar" || opt === "-ac" || opt === "-channel_layout") {
        group = "audio";
        field = "params";
      }
    }

    // Filters (video/audio/complex).
    if (!group) {
      if (opt === "-vf" || opt === "-filter_complex") {
        group = "filters";
        field = "videoFilters";
      } else if (opt === "-af") {
        group = "filters";
        field = "audioFilters";
      }
    }

    // Container / muxer.
    if (!group) {
      if (opt === "-f") {
        group = "container";
        field = "format";
      } else if (opt === "-movflags") {
        group = "container";
        field = "movflags";
      } else if (opt.startsWith("-segment_") || opt.startsWith("-hls_") || opt.startsWith("-dash")) {
        group = "container";
        field = "segmenting";
      }
    }

    // Hardware & bitstream filters.
    if (!group) {
      if (opt === "-hwaccel" || opt === "-hwaccel_device" || opt === "-hwaccel_output_format") {
        group = "hardware";
        field = "hwaccel";
      } else if (opt === "-bsf") {
        group = "hardware";
        field = "bitstreamFilters";
      }
    }

    if (!group) continue;

    mark(i, group, field);

    // Also mark the immediate value token so clicking it still navigates.
    let j = i + 1;
    while (j < len && result[j].kind === "whitespace") j += 1;
    if (j < len && result[j].kind !== "option") {
      mark(j, group, field);
    }
  }

  return result;
};

const commandTokenClass = (kind: CommandTokenKind): string => {
  switch (kind) {
    case "program":
      return "text-emerald-400";
    case "option":
      return "text-blue-400";
    case "path":
      return "text-amber-400";
    case "encoder":
      return "text-purple-300";
    case "placeholder":
      return "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded px-0.5 cursor-help";
    default:
      return "";
  }
};

const commandTokenTitle = (kind: CommandTokenKind, rawText: string): string | null => {
  const unquoted = stripQuotes(rawText);
  const lower = unquoted.toLowerCase();

  if (kind === "placeholder") {
    if (unquoted === "INPUT") {
      return "INPUT 占位符：执行时会替换为输入文件路径";
    }
    if (unquoted === "OUTPUT") {
      return "OUTPUT 占位符：执行时会替换为输出文件路径";
    }
  }

  if (kind === "option") {
    if (lower === "-progress") {
      return "-progress pipe:2：强制启用结构化进度输出，队列根据它实时更新任务进度（系统自动注入，无法关闭）。";
    }
    if (lower === "-nostdin") {
      return "-nostdin：禁止从标准输入读取，防止 ffmpeg 在无人值守队列中卡在交互式提问（系统自动注入，无法关闭）。";
    }
  }

  if (kind === "other" && unquoted === "pipe:2") {
    return "pipe:2：将 -progress 的结构化进度信息写入 stderr，以便队列解析。";
  }

  return null;
};

export const highlightFfmpegCommand = (
  command: string | undefined | null,
): string => {
  const tokens = assignCommandTokenGroups(tokenizeFfmpegCommand(command));
  if (!tokens.length) return "";

  return tokens
    .map((token) => {
      const cls = commandTokenClass(token.kind);
      const escaped = escapeHtml(token.text);
      if (!cls) return escaped;
      const title = commandTokenTitle(token.kind, token.text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const groupAttr = token.group ? ` data-group="${escapeHtml(token.group)}"` : "";
      const fieldAttr = token.field ? ` data-field="${escapeHtml(token.field)}"` : "";
      return `<span class="${cls}"${titleAttr}${groupAttr}${fieldAttr}>${escaped}</span>`;
    })
    .join("");
};

const hasInputPlaceholderShape = (raw: string): boolean => {
  const lower = stripQuotes(raw).toLowerCase();
  return (
    lower.includes("input") ||
    lower.includes("infile") ||
    lower.includes("输入") ||
    lower.includes("源文件") ||
    lower.includes("原始文件")
  );
};

const hasOutputPlaceholderShape = (raw: string): boolean => {
  const lower = stripQuotes(raw).toLowerCase();
  return (
    lower.includes("output") ||
    lower.includes("outfile") ||
    lower.includes("输出") ||
    lower.includes("目标文件") ||
    lower.includes("结果文件")
  );
};

const wrapWithSameQuotes = (original: string, placeholder: string): string => {
  const match = original.match(/^(['"])(.*)\1$/);
  if (match) {
    return `${match[1]}${placeholder}${match[1]}`;
  }
  return placeholder;
};

/**
 * Normalize a raw ffmpeg command string into the template format we expect
 * in presets, replacing the detected input/output path with INPUT / OUTPUT
 * placeholders while preserving other flags.
 */
export const normalizeFfmpegTemplate = (raw: string): TemplateParseResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { template: "", inputReplaced: false, outputReplaced: false };
  }

  const segments = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  if (segments.length === 0) {
    return { template: trimmed, inputReplaced: false, outputReplaced: false };
  }

  const tokens = [...segments];

  // Normalize the program token so templates stay stable even when the
  // runtime path points to a local dev build such as
  // `E:\RustWorkSpace\ffui\src-tauri\target\debug\tools\ffmpeg.exe`.
  if (tokens.length > 0) {
    const first = tokens[0];
    const unquoted = stripQuotes(first);
    const lowerFirst = unquoted.toLowerCase();
    if (/(?:^|[\\/])ffmpeg(?:\.exe)?$/.test(lowerFirst)) {
      tokens[0] = "ffmpeg";
    } else if (/(?:^|[\\/])ffprobe(?:\.exe)?$/.test(lowerFirst)) {
      tokens[0] = "ffprobe";
    }
  }

  let inputIndex = -1;
  let outputIndex = -1;

  // 1) Prefer explicit `-i <path>` style for input.
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (token === "-i" || token === "-input") {
      const candidate = tokens[i + 1];
      if (candidate && !candidate.startsWith("-")) {
        inputIndex = i + 1;
        break;
      }
    }
  }

  // 2) Fallback: first placeholder-shaped token as input.
  if (inputIndex === -1) {
    inputIndex = tokens.findIndex((t) => hasInputPlaceholderShape(t));
  }

  if (inputIndex >= 0) {
    tokens[inputIndex] = wrapWithSameQuotes(tokens[inputIndex], "INPUT");
  }

  // 3) Output: prefer explicit placeholder-shaped token.
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (i === inputIndex) continue;
    const token = tokens[i];
    if (hasOutputPlaceholderShape(token)) {
      outputIndex = i;
      break;
    }
  }

  // 4) Fallback: last non-option, non-program token as output.
  if (outputIndex === -1) {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (i === inputIndex) continue;
      const token = tokens[i];
      if (token.startsWith("-")) continue;
      const lower = stripQuotes(token).toLowerCase();
      if (lower === "ffmpeg" || lower === "ffprobe") continue;
      outputIndex = i;
      break;
    }
  }

  if (outputIndex >= 0) {
    tokens[outputIndex] = wrapWithSameQuotes(tokens[outputIndex], "OUTPUT");
  }

  return {
    template: tokens.join(" "),
    inputReplaced: inputIndex >= 0,
    outputReplaced: outputIndex >= 0,
  };
};

export interface FfmpegCommandPreviewInput {
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  global?: GlobalConfig;
  input?: InputTimelineConfig;
  mapping?: MappingConfig;
  subtitles?: SubtitlesConfig;
  container?: ContainerConfig;
  hardware?: HardwareConfig;
  /** When true and template is non-empty, use the raw template instead of structured flags. */
  advancedEnabled?: boolean;
  /** Optional full ffmpeg command template using INPUT/OUTPUT placeholders. */
  ffmpegTemplate?: string;
}

/**
 * Build a structured ffmpeg command preview from typed preset fields.
 * This mirrors the logic used by the preset wizard and parameter panel.
 */
export const buildFfmpegCommandFromStructured = (
  input: FfmpegCommandPreviewInput,
): string => {
  const inputPlaceholder = "INPUT";
  const outputPlaceholder = "OUTPUT";

  const v = input.video as VideoConfig;
  const a = input.audio as AudioConfig;
  const f = input.filters as FilterConfig;
  const g = input.global as GlobalConfig | undefined;
  const timeline = input.input as InputTimelineConfig | undefined;
  const mapping = input.mapping as MappingConfig | undefined;
  const subtitles = input.subtitles as SubtitlesConfig | undefined;
  const container = input.container as ContainerConfig | undefined;
  const hardware = input.hardware as HardwareConfig | undefined;

  const canApplyVideoFilters = v.encoder !== "copy";
  const canApplyAudioFilters = a.codec !== "copy";

  const args: string[] = [];

  // Ensure ffmpeg emits machine-readable progress so the backend and UI
  // share the same argument sequence (`-progress pipe:2` is injected in
  // Rust via ensure_progress_args). Keeping this here makes the preview
  // reflect the actual command that will be executed.
  args.push("-progress", "pipe:2");
  // Run ffmpeg in a non-interactive style that is safe for unattended queue
  // processing; this matches the backend behaviour in `build_ffmpeg_args`.
  args.push("-nostdin");

  // Global options come first so they affect the whole invocation.
  if (g) {
    if (g.overwriteBehavior === "overwrite") {
      args.push("-y");
    } else if (g.overwriteBehavior === "noOverwrite") {
      args.push("-n");
    }
    if (g.logLevel) {
      args.push("-loglevel", g.logLevel);
    }
    if (g.hideBanner) {
      args.push("-hide_banner");
    }
    if (g.enableReport) {
      args.push("-report");
    }
  }

  // Input-level options that must appear before the first `-i`.
  if (timeline && timeline.seekMode === "input" && timeline.seekPosition) {
    args.push("-ss", timeline.seekPosition);
    if (timeline.accurateSeek) {
      args.push("-accurate_seek");
    }
  }

  // Input
  args.push("-i", inputPlaceholder);

  // Input/timeline options that are applied after the input declaration.
  if (timeline) {
    if (timeline.seekMode === "output" && timeline.seekPosition) {
      args.push("-ss", timeline.seekPosition);
    }
    if (timeline.duration && timeline.durationMode) {
      if (timeline.durationMode === "duration") {
        args.push("-t", timeline.duration);
      } else if (timeline.durationMode === "to") {
        args.push("-to", timeline.duration);
      }
    }
    if (timeline.accurateSeek && timeline.seekMode !== "input") {
      // When using output-side seeking we still allow explicit accurate seeks.
      args.push("-accurate_seek");
    }
  }

  // Stream mapping and metadata.
  if (mapping) {
    if (Array.isArray(mapping.maps)) {
      for (const m of mapping.maps) {
        const trimmed = (m ?? "").trim();
        if (trimmed) {
          args.push("-map", trimmed);
        }
      }
    }
    if (Array.isArray(mapping.dispositions)) {
      for (const d of mapping.dispositions) {
        const trimmed = (d ?? "").trim();
        if (trimmed) {
          args.push("-disposition", trimmed);
        }
      }
    }
    if (Array.isArray(mapping.metadata)) {
      for (const kv of mapping.metadata) {
        const trimmed = (kv ?? "").trim();
        if (trimmed) {
          args.push("-metadata", trimmed);
        }
      }
    }
  }
  // When there is no explicit mapping configuration at all, prefer a
  // “keep all primary streams” behaviour instead of ffmpeg’s implicit
  // “pick one best audio and one best video” defaults. The Rust backend
  // enforces the same behaviour when building the real command.
  if ((!mapping || (!mapping.maps || mapping.maps.length === 0)) && !args.includes("-map")) {
    args.push("-map", "0");
  }

  // video
  if (v.encoder === "copy") {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", v.encoder);

    // 速率控制：质量优先（CRF/CQ）与码率优先（CBR/VBR + two-pass）互斥。
    if (v.rateControl === "crf" || v.rateControl === "cq") {
      args.push(v.rateControl === "crf" ? "-crf" : "-cq", String(v.qualityValue));
    } else if (v.rateControl === "cbr" || v.rateControl === "vbr") {
      if (typeof v.bitrateKbps === "number" && v.bitrateKbps > 0) {
        args.push("-b:v", `${v.bitrateKbps}k`);
      }
      if (typeof v.maxBitrateKbps === "number" && v.maxBitrateKbps > 0) {
        args.push("-maxrate", `${v.maxBitrateKbps}k`);
      }
      if (typeof v.bufferSizeKbits === "number" && v.bufferSizeKbits > 0) {
        args.push("-bufsize", `${v.bufferSizeKbits}k`);
      }
      if (v.pass === 1 || v.pass === 2) {
        args.push("-pass", String(v.pass));
      }
    }

    if (v.preset) {
      args.push("-preset", v.preset);
    }
    if (v.tune) {
      args.push("-tune", v.tune);
    }
    if (v.profile) {
      args.push("-profile:v", v.profile);
    }
    if (typeof v.level === "string" && v.level.trim().length > 0) {
      args.push("-level", v.level.trim());
    }
    if (typeof v.gopSize === "number" && Number.isFinite(v.gopSize) && v.gopSize > 0) {
      args.push("-g", String(v.gopSize));
    }
    if (typeof v.bf === "number" && Number.isFinite(v.bf) && v.bf >= 0) {
      args.push("-bf", String(v.bf));
    }
    if (typeof v.pixFmt === "string" && v.pixFmt.trim().length > 0) {
      args.push("-pix_fmt", v.pixFmt.trim());
    }
  }

  // audio
  if (a.codec === "copy") {
    args.push("-c:a", "copy");
  } else if (a.codec === "aac") {
    args.push("-c:a", "aac");
    if (a.bitrate) {
      args.push("-b:a", `${a.bitrate}k`);
    }
    if (a.sampleRateHz) {
      args.push("-ar", String(a.sampleRateHz));
    }
    if (a.channels) {
      args.push("-ac", String(a.channels));
    }
    if (a.channelLayout) {
      args.push("-channel_layout", a.channelLayout);
    }
  }

  // filters + optional subtitle burn-in
  const vfParts: string[] = [];
  if (canApplyVideoFilters) {
    if (f.scale) {
      vfParts.push(`scale=${f.scale}`);
    }
    if (f.crop) {
      vfParts.push(`crop=${f.crop}`);
    }
    if (typeof f.fps === "number" && f.fps > 0) {
      vfParts.push(`fps=${f.fps}`);
    }
    // For burn-in subtitles we append the caller-provided filter expression
    // into the main video filter chain.
    if (subtitles?.strategy === "burn_in" && subtitles.burnInFilter) {
      const expr = subtitles.burnInFilter.trim();
      if (expr) {
        vfParts.push(expr);
      }
    }
  }

  const vfChain = typeof f.vfChain === "string" ? f.vfChain.trim() : "";
  if (canApplyVideoFilters && (vfParts.length > 0 || vfChain.length > 0)) {
    const parts: string[] = [];
    if (vfParts.length > 0) {
      parts.push(vfParts.join(","));
    }
    if (vfChain.length > 0) {
      parts.push(vfChain);
    }
    args.push("-vf", parts.join(","));
  }

  if (canApplyAudioFilters) {
    const afParts: string[] = [];

    // Structured loudness normalization via loudnorm, driven by audio
    // loudness profile and optional override fields. We keep the mapping
    // simple and conservative, matching common broadcast practice:
    // - CN 广播：I ≈ -24 LUFS, LRA ≈ 7 LU, TP ≈ -2 dBTP
    // - EBU/国际：I ≈ -23 LUFS, LRA ≈ 7 LU, TP ≈ -1 dBTP
    const profile = a.loudnessProfile ?? "none";
    if (profile !== "none") {
      const defaultI = a.targetLufs ?? (profile === "cnBroadcast" ? -24 : -23);
      const defaultLra = a.loudnessRange ?? 7;
      const defaultTp = a.truePeakDb ?? (profile === "cnBroadcast" ? -2 : -1);

      // Clamp obviously unsafe values into a conservative band so users不会
      // 意外把真峰值推到 0dBTP 甚至正值。
      const safeI = Math.max(-36, Math.min(-10, defaultI));
      const safeLra = Math.max(1, Math.min(20, defaultLra));
      const safeTp = Math.min(-0.1, defaultTp);

      const loudnormExpr = `loudnorm=I=${safeI}:LRA=${safeLra}:TP=${safeTp}:print_format=summary`;
      afParts.push(loudnormExpr);
    }

    const afChain = f.afChain?.trim();
    if (afChain && afChain.length > 0) {
      afParts.push(afChain);
    }

    if (afParts.length > 0) {
      args.push("-af", afParts.join(","));
    }
  }
  if (canApplyVideoFilters && f.filterComplex && f.filterComplex.trim().length > 0) {
    args.push("-filter_complex", f.filterComplex.trim());
  }

  // Subtitle strategy: keep/drop (burn-in is handled via the filter chain).
  if (subtitles?.strategy === "drop") {
    // Disable subtitle streams entirely.
    args.push("-sn");
  }

  // Container / muxer options.
  if (container) {
    if (container.format && container.format.trim().length > 0) {
      args.push("-f", container.format.trim());
    }
    if (container.movflags && container.movflags.length > 0) {
      const joined = container.movflags
        .map((flag) => (flag ?? "").trim())
        .filter((flag) => flag.length > 0)
        .join("+");
      if (joined.length > 0) {
        args.push("-movflags", joined);
      }
    }
  }

  // Hardware and bitstream filter options.
  if (hardware) {
    if (hardware.hwaccel && hardware.hwaccel.trim().length > 0) {
      args.push("-hwaccel", hardware.hwaccel.trim());
    }
    if (hardware.hwaccelDevice && hardware.hwaccelDevice.trim().length > 0) {
      args.push("-hwaccel_device", hardware.hwaccelDevice.trim());
    }
    if (
      hardware.hwaccelOutputFormat &&
      hardware.hwaccelOutputFormat.trim().length > 0
    ) {
      args.push("-hwaccel_output_format", hardware.hwaccelOutputFormat.trim());
    }
    if (hardware.bitstreamFilters && hardware.bitstreamFilters.length > 0) {
      for (const bsf of hardware.bitstreamFilters) {
        const trimmed = (bsf ?? "").trim();
        if (trimmed) {
          args.push("-bsf", trimmed);
        }
      }
    }
  }

  // output
  args.push(outputPlaceholder);

  return ["ffmpeg", ...args].join(" ");
};

/**
 * Compute the effective ffmpeg command preview for a given preset-like input,
 * honoring advanced/template mode when enabled.
 */
export const getFfmpegCommandPreview = (
  input: FfmpegCommandPreviewInput,
): string => {
  const template = (input.ffmpegTemplate ?? "").trim();
  if (input.advancedEnabled && template.length > 0) {
    return template;
  }
  return buildFfmpegCommandFromStructured(input);
};

/**
 * Convenience helper for computing the command preview of a persisted preset.
 */
export const getPresetCommandPreview = (preset: FFmpegPreset): string =>
  getFfmpegCommandPreview({
    global: preset.global,
    input: preset.input,
    mapping: preset.mapping,
    video: preset.video,
    audio: preset.audio,
    filters: preset.filters,
    subtitles: preset.subtitles,
    container: preset.container,
    hardware: preset.hardware,
    advancedEnabled: preset.advancedEnabled,
    ffmpegTemplate: preset.ffmpegTemplate,
  });
