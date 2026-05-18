export type FfmpegCommandPreviewPlatform = "windows" | "posix";

export interface FfmpegCommandPreviewOptions {
  platform?: FfmpegCommandPreviewPlatform;
}

const normalizePreviewPlatform = (value: unknown): FfmpegCommandPreviewPlatform | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "windows" || normalized === "win32") return "windows";
  if (normalized === "linux" || normalized === "darwin" || normalized === "macos" || normalized === "posix") {
    return "posix";
  }
  return undefined;
};

export const detectRuntimePreviewPlatform = (): FfmpegCommandPreviewPlatform => {
  const runtime = globalThis as typeof globalThis & {
    window?: { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: unknown } };
    navigator?: { platform?: string; userAgent?: string };
    process?: { platform?: string };
  };

  const tauriPlatform = normalizePreviewPlatform(runtime.window?.__TAURI_OS_PLUGIN_INTERNALS__?.platform);
  if (tauriPlatform) return tauriPlatform;

  const navigatorPlatform = `${runtime.navigator?.platform ?? ""} ${runtime.navigator?.userAgent ?? ""}`;
  if (/\bwin/i.test(navigatorPlatform)) return "windows";
  if (navigatorPlatform.trim().length > 0) return "posix";

  return normalizePreviewPlatform(runtime.process?.platform) ?? "posix";
};

export const resolvePreviewPlatform = (options: FfmpegCommandPreviewOptions = {}): FfmpegCommandPreviewPlatform =>
  options.platform ?? detectRuntimePreviewPlatform();
