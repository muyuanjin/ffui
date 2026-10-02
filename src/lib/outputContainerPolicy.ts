import type { OutputContainerPolicy } from "@/types/output-policy";
import { FORMAT_CATALOG, type FormatKind } from "@/lib/formatCatalog";
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "@/constants";

export const OUTPUT_MEDIA_KINDS: FormatKind[] = ["video", "audio", "image"];

const FORMAT_ALIASES: Record<string, string> = {
  matroska: "mkv",
  asf: "wmv",
  mpegts: "ts",
  rm: "rmvb",
  adts: "aac",
  aif: "aiff",
  tif: "tiff",
  m3u8: "hls",
  mpd: "dash",
};

export function outputMediaKindForExtension(extension: string): FormatKind | null {
  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  const known = FORMAT_CATALOG.find((entry) => entry.value === (FORMAT_ALIASES[normalized] ?? normalized));
  if (known) return known.kind;
  if (normalized === "tiff") return "image";
  if (VIDEO_EXTENSIONS.includes(normalized)) return "video";
  if (AUDIO_EXTENSIONS.includes(normalized)) return "audio";
  if (IMAGE_EXTENSIONS.includes(normalized)) return "image";
  return null;
}

export function resolveOutputContainerForExtension(
  container: OutputContainerPolicy,
  extension: string,
): Exclude<OutputContainerPolicy, { mode: "byMedia" }> {
  const kind = outputMediaKindForExtension(extension);
  return resolveOutputContainerForMedia(container, kind);
}

export function resolveOutputContainerForMedia(
  container: OutputContainerPolicy,
  kind: FormatKind | null,
): Exclude<OutputContainerPolicy, { mode: "byMedia" }> {
  if (container.mode !== "byMedia") return container;
  const format = kind ? container[kind] : undefined;
  return format ? { mode: "force", format } : { mode: "default" };
}
