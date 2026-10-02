import { invokeCommand } from "./invokeCommand";
import type { MediaPreviewInfo } from "./generated/queue-contracts";

export type { PreviewMediaKind, MediaPreviewInfo } from "./generated/queue-contracts";

export async function probeMediaPreviewInfo(sourcePath: string): Promise<MediaPreviewInfo> {
  const value = await invokeCommand<MediaPreviewInfo>("probe_media_preview_info", { sourcePath });
  if (
    !value ||
    !["audio", "image", "video"].includes(value.kind) ||
    !(
      value.durationSeconds === null ||
      (typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0)
    )
  ) {
    throw new Error("Invalid media preview probe response");
  }
  return value;
}

export async function prepareNativeMediaPreview(sourcePath: string, kind: "audio" | "image"): Promise<string> {
  return invokeCommand<string>("prepare_native_media_preview", { sourcePath, kind });
}
