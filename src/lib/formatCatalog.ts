export type FormatKind = "video" | "audio" | "image";

export interface FormatCatalogEntry {
  /** Stable id for selection (usually the extension without dot). */
  value: string;
  /** Display label (short). */
  label: string;
  /** Category used for grouped pickers. */
  kind: FormatKind;
  /** Search keywords: extension aliases, muxer names, common names. */
  keywords: string[];
  /** Optional helper note shown in UI. */
  note?: string;
  /** When true, selection is disabled in structured video container pickers. */
  disabledInVideoPickers?: boolean;
}

const kw = (...items: string[]) =>
  items
    .flatMap((v) => String(v).split(/[,\s/]+/g))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

export const FORMAT_CATALOG: FormatCatalogEntry[] = [
  // ---- Video containers ----
  {
    value: "mp4",
    label: "MP4 (.mp4)",
    kind: "video",
    keywords: kw("mp4", ".mp4", "isom", "mov", "faststart"),
    note: "常用：可配合 movflags=faststart 改善网页端首帧加载",
  },
  {
    value: "mkv",
    label: "MKV / Matroska (.mkv)",
    kind: "video",
    keywords: kw("mkv", ".mkv", "matroska"),
    note: "兼容性强，容器限制少（推荐兜底）",
  },
  { value: "mov", label: "MOV (.mov)", kind: "video", keywords: kw("mov", ".mov", "quicktime") },
  {
    value: "webm",
    label: "WebM (.webm)",
    kind: "video",
    keywords: kw("webm", ".webm", "vp9", "av1", "opus", "vorbis"),
    note: "仅支持 VP8/VP9/AV1 视频 + Opus/Vorbis 音频",
  },
  { value: "flv", label: "FLV (.flv)", kind: "video", keywords: kw("flv", ".flv") },
  { value: "avi", label: "AVI (.avi)", kind: "video", keywords: kw("avi", ".avi") },
  {
    value: "wmv",
    label: "WMV (.wmv)",
    kind: "video",
    keywords: kw("wmv", ".wmv", "asf"),
    note: "ffmpeg muxer 为 asf；现代编码兼容性有限",
  },
  {
    value: "rmvb",
    label: "RMVB (.rmvb)",
    kind: "video",
    keywords: kw("rmvb", ".rmvb", "rm"),
    note: "RealMedia 格式；现代编码/播放器兼容性有限",
  },
  {
    value: "ts",
    label: "MPEG-TS (.ts)",
    kind: "video",
    keywords: kw("ts", ".ts", "mpegts"),
    note: "ffmpeg muxer 为 mpegts；用于直播/传输流更常见",
  },
  {
    value: "m2ts",
    label: "MPEG-TS (.m2ts)",
    kind: "video",
    keywords: kw("m2ts", ".m2ts", "mpegts", "bluray"),
    note: "ffmpeg muxer 为 mpegts；常见于蓝光/录制",
  },
  { value: "mxf", label: "MXF (.mxf)", kind: "video", keywords: kw("mxf", ".mxf") },
  { value: "3gp", label: "3GP (.3gp)", kind: "video", keywords: kw("3gp", ".3gp", "3gpp") },

  // Streaming / segmentation (preset-only today)
  {
    value: "mpegts",
    label: "MPEG-TS (muxer mpegts)",
    kind: "video",
    keywords: kw("mpegts"),
    note: "等价于 ts/m2ts（muxer 名称）",
  },
  { value: "hls", label: "HLS (m3u8)", kind: "video", keywords: kw("hls", "m3u8") },
  { value: "dash", label: "DASH (mpd)", kind: "video", keywords: kw("dash", "mpd") },

  // ---- Audio containers ----
  {
    value: "mp3",
    label: "MP3 (.mp3)",
    kind: "audio",
    keywords: kw("mp3", ".mp3"),
    disabledInVideoPickers: true,
  },
  {
    value: "aac",
    label: "AAC (.aac)",
    kind: "audio",
    keywords: kw("aac", ".aac", "adts"),
    disabledInVideoPickers: true,
  },
  { value: "wav", label: "WAV (.wav)", kind: "audio", keywords: kw("wav", ".wav"), disabledInVideoPickers: true },
  {
    value: "flac",
    label: "FLAC (.flac)",
    kind: "audio",
    keywords: kw("flac", ".flac"),
    disabledInVideoPickers: true,
  },
  {
    value: "m4a",
    label: "M4A (.m4a)",
    kind: "audio",
    keywords: kw("m4a", ".m4a", "mp4", "aac", "alac"),
    note: "常见：AAC/ALAC（muxer 通常为 mp4）",
    disabledInVideoPickers: true,
  },
  {
    value: "alac",
    label: "ALAC (.alac)",
    kind: "audio",
    keywords: kw("alac", ".alac", "m4a"),
    note: "ALAC 是音频编码，常见容器为 m4a",
    disabledInVideoPickers: true,
  },
  {
    value: "aiff",
    label: "AIFF (.aiff)",
    kind: "audio",
    keywords: kw("aiff", ".aiff", "aif", ".aif"),
    disabledInVideoPickers: true,
  },
  { value: "ac3", label: "AC-3 (.ac3)", kind: "audio", keywords: kw("ac3", ".ac3"), disabledInVideoPickers: true },
  {
    value: "ogg",
    label: "Ogg (.ogg)",
    kind: "audio",
    keywords: kw("ogg", ".ogg", "vorbis"),
    disabledInVideoPickers: true,
  },
  {
    value: "opus",
    label: "Opus (.opus)",
    kind: "audio",
    keywords: kw("opus", ".opus", "ogg"),
    disabledInVideoPickers: true,
  },

  // ---- Image formats ----
  { value: "png", label: "PNG (.png)", kind: "image", keywords: kw("png", ".png"), disabledInVideoPickers: true },
  {
    value: "jpg",
    label: "JPG (.jpg)",
    kind: "image",
    keywords: kw("jpg", ".jpg", "jpeg", ".jpeg"),
    disabledInVideoPickers: true,
  },
  {
    value: "jpeg",
    label: "JPEG (.jpeg)",
    kind: "image",
    keywords: kw("jpeg", ".jpeg", "jpg", ".jpg"),
    disabledInVideoPickers: true,
  },
  { value: "webp", label: "WebP (.webp)", kind: "image", keywords: kw("webp", ".webp"), disabledInVideoPickers: true },
  { value: "avif", label: "AVIF (.avif)", kind: "image", keywords: kw("avif", ".avif"), disabledInVideoPickers: true },
  { value: "bmp", label: "BMP (.bmp)", kind: "image", keywords: kw("bmp", ".bmp"), disabledInVideoPickers: true },
];

export function filterFormatCatalog(entries: FormatCatalogEntry[], query: string): FormatCatalogEntry[] {
  const q = String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (!q) return entries;

  return entries.filter((e) => {
    if (e.value.toLowerCase().includes(q)) return true;
    if (e.label.toLowerCase().includes(q)) return true;
    return e.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

export function groupFormatCatalog(entries: FormatCatalogEntry[]): Record<FormatKind | "other", FormatCatalogEntry[]> {
  const out: Record<FormatKind | "other", FormatCatalogEntry[]> = {
    video: [],
    audio: [],
    image: [],
    other: [],
  };
  for (const e of entries) {
    if (e.kind === "video" || e.kind === "audio" || e.kind === "image") out[e.kind].push(e);
    else out.other.push(e);
  }
  return out;
}
