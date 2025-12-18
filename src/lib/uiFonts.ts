import { convertFileSrc } from "@tauri-apps/api/core";
import { hasTauri, startOpenSourceFontDownload as startOpenSourceFontDownloadInBackend } from "@/lib/backend";
import type { DownloadedFontInfo, UiFontDownloadSnapshot } from "@/lib/backend";

export type UiFontFormat = "ttf" | "otf";

export function inferUiFontFormatFromPath(path: string): UiFontFormat | null {
  const normalized = path.trim().toLowerCase();
  if (normalized.endsWith(".otf")) return "otf";
  if (normalized.endsWith(".ttf")) return "ttf";
  return null;
}

export function ensureFontFaceLoaded(options: { id: string; familyName: string; assetUrl: string; format: string }) {
  if (typeof document === "undefined") return;

  const styleId = `ffui-font-face-${options.id}`;
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
@font-face {
  font-family: "${options.familyName.replace(/"/g, '\\"')}";
  src: url("${options.assetUrl}");
  font-display: swap;
}
`.trim();
}

export async function applyDownloadedUiFont(downloaded: DownloadedFontInfo) {
  if (!hasTauri()) return;
  const assetUrl = convertFileSrc(downloaded.path);
  ensureFontFaceLoaded({
    id: downloaded.id,
    familyName: downloaded.familyName,
    assetUrl,
    format: downloaded.format,
  });
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      // Hint the browser to load the font immediately so the UI updates without
      // requiring a manual re-render or toggling settings.
      await (document as any).fonts.load(`16px "${downloaded.familyName}"`);
    } catch {
      // Best-effort: some webviews may not fully support FontFaceSet APIs.
    }
  }
}

export async function applyUiFontFilePath(options: { path: string; familyName: string; id?: string }) {
  if (!hasTauri()) return;
  const format = inferUiFontFormatFromPath(options.path) ?? "ttf";
  await applyDownloadedUiFont({
    id: options.id ?? "imported",
    familyName: options.familyName,
    path: options.path,
    format,
  });
}

export async function startOpenSourceFontDownload(fontId: string): Promise<UiFontDownloadSnapshot | null> {
  if (!hasTauri()) return null;
  const snapshot = await startOpenSourceFontDownloadInBackend(fontId);
  if (snapshot.status === "ready" && snapshot.path) {
    await applyDownloadedUiFont({
      id: snapshot.fontId,
      familyName: snapshot.familyName,
      path: snapshot.path,
      format: snapshot.format,
    });
  }
  return snapshot;
}
