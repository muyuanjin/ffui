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
 * 容器格式规范化：
 * - UI 中使用更直观的标识（例如 mkv），但 ffmpeg 实际要求 muxer 名称（例如 matroska）。
 * - 这里做一层映射，保证生成的命令始终使用 ffmpeg 支持的格式名。
 */
const normalizeContainerFormat = (format: string): string => {
  const trimmed = format.trim();
  if (!trimmed) return trimmed;

  // Matroska：扩展名常用 mkv，但 ffmpeg muxer 名称是 matroska。
  if (trimmed === "mkv") return "matroska";

  return trimmed;
};

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
  // "keep all primary streams" behaviour instead of ffmpeg's implicit
  // "pick one best audio and one best video" defaults. The Rust backend
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
