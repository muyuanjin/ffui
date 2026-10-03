import { EXTENSIONS } from "@/constants";
import type { ParsedMediaAnalysis } from "@/lib/mediaInfo";

/** 媒体信息面板能展示的媒体种类。 */
export type MediaKind = "video" | "audio" | "image";

/**
 * 按扩展名判断媒体种类。
 *
 * Media Info 面板需要区分音频与视频：只看「是不是图片」会把音频显示成视频。
 * 未知扩展名按视频处理，与队列的默认一致。
 */
export function mediaKindForPath(path: string | null | undefined): MediaKind {
  const lower = (path ?? "").toLowerCase();
  if (EXTENSIONS.images.some((ext) => lower.endsWith(ext))) return "image";
  if (EXTENSIONS.audios.some((ext) => lower.endsWith(ext))) return "audio";
  return "video";
}

export function mediaKindForAnalysis(analysis: ParsedMediaAnalysis): MediaKind | null {
  const hasAudio = analysis.streams.some((stream) => stream.codecType === "audio");
  const video = analysis.streams.find((stream) => stream.codecType === "video" && !stream.attachedPic);
  const imageFormat =
    ["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(
      analysis.format?.tags?.major_brand ?? "",
    ) ||
    (analysis.format?.formatName ?? "")
      .split(",")
      .some((name) => name.endsWith("_pipe") || ["image2", "image2pipe", "avif", "ico", "gif", "apng"].includes(name));
  if (video) return !hasAudio && (imageFormat || video.stillImage) ? "image" : "video";
  if (hasAudio) return "audio";
  if (imageFormat && analysis.streams.some((stream) => stream.codecType === "video")) return "image";
  return null;
}

/** 媒体种类对应的 i18n 键（面板只做映射，分类逻辑在上面一处）。 */
export function mediaTypeLabelKey(kind: MediaKind): string {
  if (kind === "audio") return "media.typeAudio";
  if (kind === "image") return "media.typeImage";
  return "media.typeVideo";
}
