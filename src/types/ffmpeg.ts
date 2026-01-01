export type KnownEncoderType =
  | "libx264"
  | "libx265"
  | "hevc_nvenc"
  | "h264_nvenc"
  | "av1_nvenc"
  | "hevc_qsv"
  | "av1_qsv"
  | "hevc_amf"
  | "av1_amf"
  | "libsvtav1"
  | "copy";
export type EncoderType = KnownEncoderType | string;
export type AudioCodecType = "copy" | "aac";
export type KnownRateControlMode = "crf" | "cq" | "constqp" | "cbr" | "vbr";
export type RateControlMode = KnownRateControlMode | string;
export type AudioLoudnessProfile = "none" | "cnBroadcast" | "ebuR128";

// ----- Global / input / mapping / container / hardware parameter groups -----

export type OverwriteBehavior = "ask" | "overwrite" | "noOverwrite";

export type LogLevel = "quiet" | "panic" | "fatal" | "error" | "warning" | "info" | "verbose" | "debug" | "trace";

export interface GlobalConfig {
  /** Whether to overwrite existing OUTPUT files. Undefined = ffmpeg default. */
  overwriteBehavior?: OverwriteBehavior;
  /** Optional ffmpeg loglevel; when unset, use ffmpeg default behaviour. */
  logLevel?: LogLevel;
  /** When true, hide the startup banner to keep logs compact. */
  hideBanner?: boolean;
  /** When true, enable `-report` so ffmpeg writes a diagnostic log file. */
  enableReport?: boolean;
}

export type SeekMode = "input" | "output";
export type DurationMode = "duration" | "to";

export interface InputTimelineConfig {
  /**
   * Position of `-ss` relative to the first input.
   * - input  -> `-ss` appears before `-i INPUT` (fast seek, less accurate)
   * - output -> `-ss` appears after `-i INPUT` (slower, more accurate)
   */
  seekMode?: SeekMode;
  /** Raw time expression for `-ss`, e.g. `00:01:23.000` or `90`. */
  seekPosition?: string;
  /**
   * Loop the input stream N times via `-stream_loop`.
   * - 0 means no loop
   * - -1 means infinite loop
   * - N>0 means loop N times
   */
  streamLoop?: number;
  /**
   * Input timestamp offset applied via `-itsoffset` (time duration syntax).
   * Positive delays streams; negative advances them.
   *
   * This option must appear before `-i` to affect the input.
   */
  inputTimeOffset?: string;
  /**
   * Whether to express clipping by duration (`-t`) or absolute end time (`-to`).
   * Undefined means no explicit clip limit.
   */
  durationMode?: DurationMode;
  /** Raw time expression used with `-t` or `-to`, depending on durationMode. */
  duration?: string;
  /** When true, append `-accurate_seek` alongside `-ss` for precise seeking. */
  accurateSeek?: boolean;
}

export interface MappingConfig {
  /**
   * Raw `-map` directives. Each entry becomes a `-map <value>` pair
   * in the generated ffmpeg command.
   */
  maps?: string[];
  /**
   * Control chapter copying via `-map_chapters`.
   * - undefined: ffmpeg default behaviour (copy from first input that has chapters)
   * - -1: disable any chapter copying
   * - >=0: copy chapters from the specified input file index
   */
  mapChaptersFromInputFileIndex?: number;
  /**
   * Control metadata copying via `-map_metadata`.
   * - undefined: ffmpeg default behaviour (auto copy globals + per-stream/per-chapter)
   * - -1: disable automatic metadata copying
   * - >=0: copy global metadata from the specified input file index
   *
   * Note: advanced per-stream/per-chapter specifiers like `-map_metadata:s:a 0:g`
   * are not yet represented in structured mode.
   */
  mapMetadataFromInputFileIndex?: number;
  /** Raw `-metadata` key/value pairs expressed as `key=value` strings. */
  metadata?: string[];
  /** Raw `-disposition` rules, e.g. `a:1 default` or `s:0 0`. */
  dispositions?: string[];
}

export type SubtitleStrategy = "keep" | "drop" | "burn_in";

export interface SubtitlesConfig {
  /** High-level subtitle handling strategy for this preset. */
  strategy?: SubtitleStrategy;
  /**
   * Optional filter expression used when `strategy === "burn_in"`, e.g.
   * `subtitles=INPUT:si=0`. This is appended into the video filter chain.
   */
  burnInFilter?: string;
}

export interface VideoConfig {
  encoder: EncoderType;
  rateControl: RateControlMode;
  qualityValue: number;
  preset: string;
  tune?: string;
  profile?: string;
  /** Target video bitrate in kbps when using CBR/VBR/two-pass modes. */
  bitrateKbps?: number;
  /** Optional max video bitrate in kbps for capped VBR workflows. */
  maxBitrateKbps?: number;
  /** Optional buffer size in kbits used for VBV (`-bufsize`). */
  bufferSizeKbits?: number;
  /**
   * Two-pass encoding flag: 1 or 2 when using `-pass`, undefined for single-pass.
   * The UI should ensure this only appears together with bitrate-based modes.
   */
  pass?: 1 | 2;
  /** Optional encoder level string, e.g. `4.1` or `high`. */
  level?: string;
  /** Optional GOP size (mapped to `-g`). */
  gopSize?: number;
  /** Optional B-frame count (mapped to `-bf`). */
  bf?: number;
  /** Optional pixel format, e.g. `yuv420p`. */
  pixFmt?: string;
  /** Optional NVENC b_ref_mode value, e.g. `each`. */
  bRefMode?: string;
  /** Optional lookahead depth for rate control. */
  rcLookahead?: number;
  /** Optional spatial AQ toggle. */
  spatialAq?: boolean;
  /** Optional temporal AQ toggle. */
  temporalAq?: boolean;
}

export interface AudioConfig {
  codec: AudioCodecType;
  /** Target audio bitrate in kbps when transcoding (mapped to `-b:a`). */
  bitrate?: number;
  /** Optional audio sample rate in Hz (mapped to `-ar`). */
  sampleRateHz?: number;
  /** Optional audio channel count (mapped to `-ac`). */
  channels?: number;
  /** Optional channel layout string, e.g. `stereo`, `5.1`. */
  channelLayout?: string;
  /**
   * Optional loudness normalization profile applied via `loudnorm` in the
   * audio filter chain. When undefined or `"none"`, no loudness filter is
   * injected and callers may still use raw `afChain`.
   */
  loudnessProfile?: AudioLoudnessProfile;
  /**
   * Optional target integrated loudness in LUFS used when constructing a
   * `loudnorm` expression. When omitted, we fall back to profile defaults.
   */
  targetLufs?: number;
  /**
   * Optional target loudness range (LRA). When omitted, we fall back to
   * profile defaults chosen from safe ranges in the FFmpeg guides.
   */
  loudnessRange?: number;
  /**
   * Optional true-peak limit in dBTP. When omitted, we fall back to profile
   * defaults; values close to 0dBTP are considered unsafe and may be clamped.
   */
  truePeakDb?: number;
}

export interface FilterConfig {
  /** Shorthand expression for scale filter, e.g. `-2:1080`. */
  scale?: string;
  /** Shorthand expression for crop filter. */
  crop?: string;
  /** Target output FPS for basic frame rate limiting. */
  fps?: number;
  /**
   * Optional raw `-vf` chain appended after shorthand filters. This allows
   * advanced users to add extra nodes without leaving structured mode.
   */
  vfChain?: string;
  /** Optional raw `-af` chain mapped directly to `-af`. */
  afChain?: string;
  /** Optional raw complex filter graph mapped to `-filter_complex`. */
  filterComplex?: string;
}

export interface ContainerConfig {
  /** Optional explicit output format/muxer name, mapped to `-f`. */
  format?: string;
  /**
   * Optional movflags list (e.g. `faststart`, `frag_keyframe`); when present
   * they are joined as `flag1+flag2` in a single `-movflags` argument.
   */
  movflags?: string[];
}

export interface HardwareConfig {
  /** Optional hardware acceleration backend, e.g. `cuda`, `qsv`. */
  hwaccel?: string;
  /** Optional device identifier for hwaccel, e.g. `cuda:0`. */
  hwaccelDevice?: string;
  /** Optional hwaccel output pixel format, e.g. `cuda`. */
  hwaccelOutputFormat?: string;
  /**
   * Optional list of bitstream filters, mapped to one or more `-bsf` flags.
   * Entries are passed through as-is so advanced users can control stream
   * selectors and filter names.
   */
  bitstreamFilters?: string[];
}

export interface PresetStats {
  usageCount: number;
  totalInputSizeMB: number;
  totalOutputSizeMB: number;
  totalTimeSeconds: number;
  totalFrames?: number;
}

export interface FFmpegPreset {
  id: string;
  name: string;
  description: string;
  /** Optional localized descriptions keyed by locale, e.g. { "en": "...", "zh-CN": "..." } */
  descriptionI18n?: Record<string, string>;
  /** Optional global ffmpeg options (loglevel, overwrite, banner, report). */
  global?: GlobalConfig;
  /** Optional input/timeline options (seek / trim). */
  input?: InputTimelineConfig;
  /** Optional stream mapping and metadata controls. */
  mapping?: MappingConfig;
  video: VideoConfig;
  audio: AudioConfig;
  filters: FilterConfig;
  /** Optional subtitle handling strategy for this preset. */
  subtitles?: SubtitlesConfig;
  /** Optional container/muxer-level options. */
  container?: ContainerConfig;
  /** Optional hardware/bitstream filter configuration. */
  hardware?: HardwareConfig;
  stats: PresetStats;
  /** When true, use the raw ffmpegTemplate field instead of generated args */
  advancedEnabled?: boolean;
  /** Full ffmpeg command template, e.g. `ffmpeg -i INPUT -c:v libx264 ... OUTPUT` */
  ffmpegTemplate?: string;
  /** 标记该预设是否为智能推荐预设（用户修改参数后会被清除） */
  isSmartPreset?: boolean;
}
