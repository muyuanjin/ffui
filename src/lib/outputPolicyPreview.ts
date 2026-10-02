import type { FFmpegPreset, OutputFilenameAppend, OutputPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { outputMediaKindForExtension, resolveOutputContainerForMedia } from "@/lib/outputContainerPolicy";
import type { FormatKind } from "@/lib/formatCatalog";

const DEFAULT_APPEND_ORDER: OutputFilenameAppend[] = DEFAULT_OUTPUT_POLICY.filename.appendOrder ?? [
  "suffix",
  "timestamp",
  "encoderQuality",
  "random",
];

export function normalizeAppendOrder(order: OutputFilenameAppend[] | undefined): OutputFilenameAppend[] {
  const seen = new Set<OutputFilenameAppend>();
  const out: OutputFilenameAppend[] = [];
  for (const item of order ?? []) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  for (const item of DEFAULT_APPEND_ORDER) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function normalizeContainerFormatForPreview(value: string): string {
  const trimmed = value.trim().replace(/^\./, "").toLowerCase();
  if (!trimmed) return "";

  if (trimmed === "mp4") return "mp4";
  if (trimmed === "mkv" || trimmed === "matroska") return "mkv";
  if (trimmed === "mov") return "mov";
  if (trimmed === "webm") return "webm";
  if (trimmed === "flv") return "flv";
  if (trimmed === "avi") return "avi";
  if (trimmed === "mxf") return "mxf";
  if (trimmed === "3gp") return "3gp";
  if (trimmed === "asf" || trimmed === "wmv") return "wmv";
  if (trimmed === "rm" || trimmed === "rmvb") return "rmvb";
  if (trimmed === "m4a") return "m4a";
  if (trimmed === "mp3") return "mp3";
  if (trimmed === "aac" || trimmed === "adts") return "aac";
  if (trimmed === "wav") return "wav";
  if (trimmed === "flac") return "flac";
  if (trimmed === "aiff") return "aiff";
  if (trimmed === "ac3") return "ac3";
  if (trimmed === "ogg") return "ogg";
  if (trimmed === "opus") return "opus";
  if (["png", "bmp", "tiff", "webp", "avif"].includes(trimmed)) return trimmed;
  if (trimmed === "jpg" || trimmed === "jpeg") return "jpg";
  if (trimmed === "tif") return "tiff";
  if (trimmed === "mpegts" || trimmed === "ts") return "ts";
  if (trimmed === "hls") return "m3u8";
  if (trimmed === "dash") return "mpd";
  return "";
}

export function normalizeForcedContainerExtensionForPreview(value: string): string {
  return value.trim().replace(/^\./, "").toLowerCase();
}

function splitTemplateArgs(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  const characters = Array.from(template);

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if ((character === '"' || character === "'") && quote === null) {
      quote = character;
      started = true;
      continue;
    }
    if (quote === character) {
      quote = null;
      continue;
    }
    if (character === "\\" && quote === '"' && characters[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (!quote && /\s/.test(character)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }

  if (quote) return [];
  if (started) args.push(current);
  const program = args[0]?.toLowerCase().split(/[\\/]/).pop();
  if (program === "ffmpeg" || program === "ffmpeg.exe") args.shift();
  return args;
}

function templateOutputOptions(tokens: string[], start: number, outputIndex: number): Array<[string, string]> | null {
  const options: Array<[string, string]> = [];
  const flags = new Set([
    "-an",
    "-sn",
    "-dn",
    "-vn",
    "-shortest",
    "-y",
    "-n",
    "-hide_banner",
    "-nostats",
    "-bitexact",
    "-copyts",
    "-start_at_zero",
    "-vstats",
    "-qphist",
    "-report",
    "-ignore_unknown",
    "-copy_unknown",
    "-recast_media",
    "-accurate_seek",
    "-benchmark",
    "-benchmark_all",
    "-stdin",
    "-dump",
    "-hex",
    "-re",
    "-xerror",
    "-copyinkf",
    "-auto_conversion_filters",
    "-stats",
    "-debug_ts",
    "-find_stream_info",
    "-display_hflip",
    "-display_vflip",
    "-force_fps",
    "-autorotate",
    "-autoscale",
    "-fix_sub_duration_heartbeat",
    "-fix_sub_duration",
    "-print_graphs",
    "-intra",
    "-deinterlace",
    "-psnr",
  ]);
  for (let index = start; index < outputIndex;) {
    const token = tokens[index];
    if (token === "--") {
      if (index + 1 === outputIndex) return options;
      options.length = 0;
      index += 2;
      continue;
    }
    if (!token.startsWith("-")) {
      options.length = 0;
      index += 1;
      continue;
    }
    const option = token.split(":")[0];
    if (flags.has(option) || flags.has(option.replace(/^-no/, "-"))) {
      index += 1;
      continue;
    }
    if (index + 1 >= outputIndex) return null;
    options.push([token, tokens[index + 1]]);
    index += 2;
  }
  return options;
}

function inferTemplateOutputFormat(template: string): string | null {
  const tokens = splitTemplateArgs(template.trim());
  if (/^(ffmpeg|ffmpeg\.exe)$/i.test(tokens[0] ?? "")) tokens.shift();
  const outputIndex = tokens.findIndex((token) => token === "OUTPUT");
  if (outputIndex <= 0) return null;

  let lastInputIndex: number | null = null;
  for (let i = 0; i + 1 < outputIndex; i += 1) {
    if (tokens[i] === "-i") {
      lastInputIndex = i + 1;
      i += 1;
    }
  }

  const start = lastInputIndex == null ? 0 : lastInputIndex + 1;
  const options = templateOutputOptions(tokens, start, outputIndex);
  if (!options) return null;
  const format = options.filter(([option]) => option === "-f").slice(-1)[0]?.[1] ?? null;

  if (format?.trim().toLowerCase() === "image2") {
    const codec = options
      .filter(([option]) => ["-c", "-codec", "-c:v", "-codec:v", "-c:v:0", "-codec:v:0", "-vcodec"].includes(option))
      .slice(-1)[0]?.[1];
    const imageExtension = codec === "mjpeg" ? "jpg" : codec && ["png", "bmp", "tiff"].includes(codec) ? codec : null;
    if (imageExtension) return imageExtension;
  }
  return format?.trim() || null;
}

export function inferTemplateOutputContainer(template: string): string | null {
  const format = inferTemplateOutputFormat(template);
  const normalized = format ? normalizeContainerFormatForPreview(format) : "";
  return normalized || null;
}

export function inferPresetDefaultOutputContainer(preset: FFmpegPreset | null | undefined): string | null {
  if (!preset) return null;

  if (preset.advancedEnabled && preset.ffmpegTemplate?.trim()) {
    const fromTemplate = inferTemplateOutputFormat(preset.ffmpegTemplate);
    if (fromTemplate) return normalizeContainerFormatForPreview(fromTemplate) || null;
  }

  const structured = preset.container?.format ? normalizeContainerFormatForPreview(preset.container.format) : "";
  return structured || null;
}

function audioOnlyMaps(maps: string[]): boolean {
  const positive = maps.filter((value) => !value.startsWith("-"));
  return positive.length > 0 && positive.every((value) => /^\d+:a(?::.*)?\??$/.test(value));
}

export function inferPresetOutputKind(
  preset: FFmpegPreset | null | undefined,
  inputExtension: string,
): FormatKind | null {
  if (!preset?.advancedEnabled) {
    return audioOnlyMaps(preset?.mapping?.maps ?? []) ? "audio" : outputMediaKindForExtension(inputExtension);
  }
  if (preset.outputKind) return preset.outputKind === "other" ? null : preset.outputKind;
  const tokens = splitTemplateArgs(preset.ffmpegTemplate ?? "");
  if (tokens.filter((token) => token === "OUTPUT").length !== 1 || tokens[tokens.length - 1] !== "OUTPUT") return null;
  const delimiter = tokens.indexOf("--");
  if (delimiter >= 0 && delimiter + 2 !== tokens.length) return null;
  let start = 0;
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (tokens[index] === "-i") start = index + 2;
  }
  let noVideo = false;
  let muxer: string | null = null;
  let videoCodec = false;
  const maps: string[] = [];
  for (let index = start; index + 1 < tokens.length;) {
    const option = tokens[index];
    if (["-vn", "-an", "-sn", "-dn", "-y", "-n", "-shortest", "-hide_banner", "-nostats"].includes(option)) {
      noVideo ||= option === "-vn";
      index += 1;
    } else if (option.startsWith("-")) {
      if (option === "-filter_complex") return null;
      if (option === "-f") muxer = tokens[index + 1];
      videoCodec ||= ["-c:v", "-codec:v", "-vcodec"].includes(option);
      if (option === "-map") maps.push(tokens[index + 1]);
      index += 2;
    } else {
      return null;
    }
  }
  if (muxer === "image2" || (muxer && outputMediaKindForExtension(muxer) === "image")) return "image";
  if (noVideo || audioOnlyMaps(maps) || (muxer && outputMediaKindForExtension(muxer) === "audio")) return "audio";
  return videoCodec ? "video" : null;
}

function shouldFallbackWebmForPreview(preset: FFmpegPreset | null | undefined, inputExtension: string): boolean {
  if (!preset) return true;
  const inputIsWebm = inputExtension.toLowerCase() === "webm";
  if (preset.advancedEnabled && preset.ffmpegTemplate?.trim()) {
    const tokens = splitTemplateArgs(preset.ffmpegTemplate);
    const outputIndex = tokens.indexOf("OUTPUT");
    if (outputIndex < 0) return false;
    let start = 0;
    for (let index = 0; index + 1 < outputIndex; index += 1) {
      if (tokens[index] === "-i") {
        start = index + 2;
        index += 1;
      }
    }
    let video: string | null = null;
    let audio: string | null = null;
    for (let index = start; index + 1 < outputIndex; index += 1) {
      if (tokens[index] === "-c:v") {
        video = tokens[index + 1].trim().toLowerCase();
        index += 1;
      } else if (tokens[index] === "-c:a") {
        audio = tokens[index + 1].trim().toLowerCase();
        index += 1;
      }
    }
    if (!video || !audio) return false;
    const videoOk =
      [
        "vp8",
        "libvpx",
        "vp9",
        "libvpx-vp9",
        "av1",
        "libaom-av1",
        "libsvtav1",
        "av1_nvenc",
        "av1_qsv",
        "av1_amf",
      ].includes(video) ||
      (video === "copy" && inputIsWebm);
    const audioOk = ["opus", "libopus", "vorbis", "libvorbis"].includes(audio) || (audio === "copy" && inputIsWebm);
    return !(videoOk && audioOk);
  }
  const videoOk =
    ["av1_nvenc", "av1_qsv", "av1_amf", "libsvtav1"].includes(preset.video.encoder) ||
    (preset.video.encoder === "copy" && inputIsWebm);
  const audioOk = preset.audio.codec === "copy" && inputIsWebm;
  return !(videoOk && audioOk);
}

export function previewOutputPathLocal(
  inputPath: string,
  policy: OutputPolicy,
  options: { preset?: FFmpegPreset | null } = {},
): string {
  const raw = inputPath.trim();
  if (!raw) return "";

  const normalizedInput = raw.replace(/\\/g, "/");
  const lastSlash = normalizedInput.lastIndexOf("/");
  const dir = lastSlash >= 0 ? normalizedInput.slice(0, lastSlash) : "";
  const file = lastSlash >= 0 ? normalizedInput.slice(lastSlash + 1) : normalizedInput;
  const lastDot = file.lastIndexOf(".");
  const stem = lastDot > 0 ? file.slice(0, lastDot) : file;
  const inputExt = lastDot > 0 ? file.slice(lastDot + 1) : "";
  const ext = inputExt || "mp4";

  const outDir =
    policy.directory.mode === "fixed" && policy.directory.directory?.trim()
      ? policy.directory.directory.trim().replace(/\\/g, "/")
      : dir;

  const container = resolveOutputContainerForMedia(policy.container, inferPresetOutputKind(options.preset, inputExt));
  let outExt =
    container.mode === "force"
      ? normalizeForcedContainerExtensionForPreview(String(container.format || ext)) || ext
      : container.mode === "keepInput"
        ? ext
        : (inferPresetDefaultOutputContainer(options.preset) ?? ext);
  if (container.mode === "force" && outExt === "webm" && shouldFallbackWebmForPreview(options.preset, inputExt)) {
    outExt = "mkv";
  }

  let outStem = stem;
  if (policy.filename.regexReplace?.pattern) {
    try {
      const re = new RegExp(policy.filename.regexReplace.pattern);
      outStem = outStem.replace(re, policy.filename.regexReplace.replacement ?? "");
    } catch {
      // ignore invalid regex in preview (Rust will validate at runtime)
    }
  }

  if (policy.filename.prefix) outStem = `${policy.filename.prefix}${outStem}`;

  for (const item of normalizeAppendOrder(policy.filename.appendOrder)) {
    if (item === "suffix") {
      if (policy.filename.suffix) outStem = `${outStem}${policy.filename.suffix}`;
      continue;
    }
    if (item === "timestamp") {
      if (policy.filename.appendTimestamp) outStem = `${outStem}-YYYYMMDD-HHmmss`;
      continue;
    }
    if (item === "encoderQuality") {
      if (policy.filename.appendEncoderQuality) outStem = `${outStem}-ENC-QUALITY`;
      continue;
    }
    if (item === "random") {
      if (typeof policy.filename.randomSuffixLen === "number" && policy.filename.randomSuffixLen > 0) {
        outStem = `${outStem}-RANDOM`;
      }
      continue;
    }
  }

  const outDirTrimmed = outDir.replace(/\/+$/, "");
  const joiner = outDirTrimmed ? `${outDirTrimmed}/` : "";
  return `${joiner}${outStem}.${outExt}`;
}
