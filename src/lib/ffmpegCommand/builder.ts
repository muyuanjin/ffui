import type {
  AudioConfig,
  ContainerConfig,
  FFmpegPreset,
  FilterConfig,
  GlobalConfig,
  HardwareConfig,
  InputTimelineConfig,
  MappingConfig,
  SubtitlesConfig,
  VideoConfig,
} from "@/types";
import { getCqArgumentForEncoder } from "@/lib/presetEditorContract/encoderCapabilityRegistry";
import { normalizeFpsExpressionForSave } from "@/lib/fpsExpression";
import { isStructuredTwoPassVideo } from "@/lib/twoPassPredicate";
import {
  detectRuntimePreviewPlatform,
  resolvePreviewPlatform,
  type FfmpegCommandPreviewOptions,
} from "./previewPlatform";

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

const normalizeContainerFormat = (format: string): string => {
  const trimmed = format.trim();
  if (!trimmed) return trimmed;

  const lower = trimmed.toLowerCase();

  // Matroska：扩展名常用 mkv，但 ffmpeg muxer 名称是 matroska。
  if (lower === "mkv" || lower === "matroska") return "matroska";

  // MPEG-TS：ts/m2ts 都对应 mpegts muxer。
  if (lower === "ts" || lower === "m2ts" || lower === "mpegts") return "mpegts";

  // WMV：通常通过 ASF muxer 封装。
  if (lower === "wmv" || lower === "asf") return "asf";

  // M4A：属于 MP4 家族容器，muxer 使用 mp4。
  if (lower === "m4a" || lower === "mp4") return "mp4";

  // RM/RMVB：RealMedia muxer 名称为 rm。
  if (lower === "rmvb" || lower === "rm") return "rm";

  return lower;
};

const autoMapExclusionsForMuxer = (muxer?: string | null): string[] => {
  const normalized = typeof muxer === "string" ? normalizeContainerFormat(muxer) : "";
  if (normalized === "matroska" || normalized === "webm") {
    return ["-0:d"];
  }
  return [];
};

export const buildFfmpegCommandFromStructured = (
  input: FfmpegCommandPreviewInput,
  options: FfmpegCommandPreviewOptions = {},
): string => {
  const platform = resolvePreviewPlatform(options);
  if (isStructuredTwoPassVideo(input.video)) {
    return buildStructuredTwoPassCommand(input, { platform });
  }
  return buildStructuredSingleCommand(input, { platform });
};

const buildStructuredTwoPassCommand = (
  input: FfmpegCommandPreviewInput,
  options: Required<FfmpegCommandPreviewOptions>,
): string => {
  const passOne = buildStructuredSingleCommand(
    { ...input, video: { ...input.video, pass: 1 } },
    { ...options, twoPassFirstPass: true },
  );
  const passTwo = buildStructuredSingleCommand({ ...input, video: { ...input.video, pass: 2 } }, options);
  return `${passOne} && ${passTwo}`;
};

interface StructuredCommandOptions extends Required<FfmpegCommandPreviewOptions> {
  twoPassFirstPass?: boolean;
}

const buildStructuredSingleCommand = (
  input: FfmpegCommandPreviewInput,
  options: StructuredCommandOptions = { platform: detectRuntimePreviewPlatform() },
): string => {
  const inputPlaceholder = "INPUT";
  const outputPlaceholder = options.twoPassFirstPass && options.platform === "windows" ? "NUL" : "OUTPUT";
  const finalOutputPlaceholder =
    options.twoPassFirstPass && options.platform === "posix" ? "/dev/null" : outputPlaceholder;
  const passLogOutputPlaceholder = "OUTPUT";

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
  if (timeline && typeof timeline.streamLoop === "number" && Number.isFinite(timeline.streamLoop)) {
    args.push("-stream_loop", String(timeline.streamLoop));
  }
  if (timeline && typeof timeline.inputTimeOffset === "string" && timeline.inputTimeOffset.trim().length > 0) {
    args.push("-itsoffset", timeline.inputTimeOffset.trim());
  }
  if (timeline && timeline.seekMode === "input" && timeline.seekPosition) {
    args.push("-ss", timeline.seekPosition);
    if (timeline.accurateSeek) {
      args.push("-accurate_seek");
    }
  }
  if (hardware) {
    if (hardware.hwaccel && hardware.hwaccel.trim().length > 0) {
      args.push("-hwaccel", hardware.hwaccel.trim());
    }
    if (hardware.hwaccelDevice && hardware.hwaccelDevice.trim().length > 0) {
      args.push("-hwaccel_device", hardware.hwaccelDevice.trim());
    }
    if (hardware.hwaccelOutputFormat && hardware.hwaccelOutputFormat.trim().length > 0) {
      args.push("-hwaccel_output_format", hardware.hwaccelOutputFormat.trim());
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
    if (
      typeof mapping.mapMetadataFromInputFileIndex === "number" &&
      Number.isFinite(mapping.mapMetadataFromInputFileIndex)
    ) {
      args.push("-map_metadata", String(mapping.mapMetadataFromInputFileIndex));
    }
    if (
      typeof mapping.mapChaptersFromInputFileIndex === "number" &&
      Number.isFinite(mapping.mapChaptersFromInputFileIndex)
    ) {
      args.push("-map_chapters", String(mapping.mapChaptersFromInputFileIndex));
    }
    if (Array.isArray(mapping.dispositions)) {
      for (const d of mapping.dispositions) {
        const trimmed = (d ?? "").trim();
        if (trimmed) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const rawSpec = String(parts[0] ?? "").trim();
            const value = parts.slice(1).join(" ");
            const spec = /^\d+:(v|a|s|d)(:|$)/.test(rawSpec) ? rawSpec.replace(/^\d+:/, "") : rawSpec;
            if (spec && value) {
              args.push(`-disposition:${spec}`, value);
              continue;
            }
          }
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
  // "keep all mapped streams" behaviour instead of ffmpeg's implicit
  // "pick one best audio and one best video" defaults. Some muxers reject
  // FFmpeg data streams, so structured auto mode can append negative maps to
  // exclude only those incompatible tracks while still preserving subtitles.
  const hasExplicitMap = Array.isArray(mapping?.maps) && mapping.maps.some((m) => String(m ?? "").trim().length > 0);
  if (!hasExplicitMap && !args.includes("-map")) {
    args.push("-map", "0");
    for (const exclusion of autoMapExclusionsForMuxer(container?.format)) {
      args.push("-map", exclusion);
    }
  }

  // video
  if (v.encoder === "copy") {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", v.encoder);

    // 速率控制：质量优先（CRF/CQ/ConstQP）与码率优先（CBR/VBR + two-pass）互斥。
    if (v.rateControl === "constqp") {
      args.push("-rc", "constqp", "-qp", String(v.qualityValue));
    } else if (v.rateControl === "crf" || v.rateControl === "cq") {
      if (v.rateControl === "crf") {
        args.push("-crf", String(v.qualityValue));
      } else {
        const encLower = String(v.encoder ?? "").toLowerCase();
        // AMF uses QP fields rather than CQ/global_quality in ffmpeg.
        if (encLower.includes("_amf")) {
          args.push("-qp_i", String(v.qualityValue));
          args.push("-qp_p", String(v.qualityValue));
        } else {
          args.push(getCqArgumentForEncoder(v.encoder), String(v.qualityValue));
        }
      }
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
      const passEnabled = (v.pass === 1 || v.pass === 2) && typeof v.bitrateKbps === "number" && v.bitrateKbps > 0;
      if (passEnabled) {
        args.push("-passlogfile", `${passLogOutputPlaceholder}.ffui2pass`);
        args.push("-pass", v.pass === 1 ? "1" : "2");
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
    if (typeof v.bRefMode === "string" && v.bRefMode.trim().length > 0) {
      args.push("-b_ref_mode", v.bRefMode.trim());
    }
    if (typeof v.rcLookahead === "number" && Number.isFinite(v.rcLookahead) && v.rcLookahead > 0) {
      args.push("-rc-lookahead", String(v.rcLookahead));
    }
    if (v.spatialAq === true) {
      args.push("-spatial-aq", "1");
    }
    if (v.temporalAq === true) {
      args.push("-temporal-aq", "1");
    }
  }

  // audio
  if (!options.twoPassFirstPass) {
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
    const fps = normalizeFpsExpressionForSave(f.fps);
    if (fps) {
      vfParts.push(`fps=${fps}`);
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

  if (canApplyAudioFilters && !options.twoPassFirstPass) {
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

  if (options.twoPassFirstPass) {
    args.push("-an", "-sn", "-dn");
  } else if (subtitles?.strategy === "drop") {
    // Subtitle strategy: keep/drop (burn-in is handled via the filter chain).
    // Disable subtitle streams entirely.
    args.push("-sn");
  }

  // Container / muxer options.
  if (options.twoPassFirstPass) {
    args.push("-f", "null");
  } else if (container) {
    if (container.format && container.format.trim().length > 0) {
      const fmt = normalizeContainerFormat(container.format);
      if (fmt.length > 0) {
        args.push("-f", fmt);
      }
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

  // Bitstream filters are output-side options and must stay before OUTPUT.
  if (hardware && !options.twoPassFirstPass) {
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
  args.push(finalOutputPlaceholder);

  return ["ffmpeg", ...args].join(" ");
};

export const getFfmpegCommandPreview = (
  input: FfmpegCommandPreviewInput,
  options: FfmpegCommandPreviewOptions = {},
): string => {
  const template = (input.ffmpegTemplate ?? "").trim();
  if (input.advancedEnabled && template.length > 0) {
    return template;
  }
  return buildFfmpegCommandFromStructured(input, options);
};

export const getPresetCommandPreview = (preset: FFmpegPreset, options: FfmpegCommandPreviewOptions = {}): string =>
  getFfmpegCommandPreview(
    {
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
    },
    options,
  );
