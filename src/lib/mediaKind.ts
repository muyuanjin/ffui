import { EXTENSIONS } from "@/constants";

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

/** 媒体种类对应的 i18n 键（面板只做映射，分类逻辑在上面一处）。 */
export function mediaTypeLabelKey(kind: MediaKind): string {
  if (kind === "audio") return "media.typeAudio";
  if (kind === "image") return "media.typeImage";
  return "media.typeVideo";
}
