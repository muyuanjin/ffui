import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload ?? {}),
    convertFileSrc: (path: string) => path,
  };
});

import {
  cancelOpenSourceFontDownload,
  ensureOpenSourceFontDownloaded,
  fetchOpenSourceFontDownloadSnapshot,
  fetchSystemFontFamilies,
  importUiFontFile,
  listOpenSourceFonts,
  startOpenSourceFontDownload,
} from "@/lib/backend";
import type { DownloadedFontInfo, OpenSourceFontInfo, UiFontDownloadSnapshot } from "@/lib/backend.types";
import type { SystemFontFamily } from "@/lib/systemFontSearch";

const makeSystemFontFamilies = (): SystemFontFamily[] => [{ primary: "Inter", names: [] }];

const makeOpenSourceFonts = (): OpenSourceFontInfo[] => [
  { id: "inter", name: "Inter", familyName: "Inter", format: "ttf" },
];

const makeSnapshot = (): UiFontDownloadSnapshot => ({
  sessionId: 1,
  fontId: "inter",
  status: "ready",
  receivedBytes: 10,
  totalBytes: 10,
  familyName: "Inter",
  format: "ttf",
  path: "/tmp/ui-fonts/inter.ttf",
  error: null,
});

const makeDownloadedFont = (): DownloadedFontInfo => ({
  id: "inter",
  familyName: "Inter",
  path: "/tmp/ui-fonts/inter.ttf",
  format: "ttf",
});

describe("backend ui fonts contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    const w = globalThis as any;
    w.window = w.window ?? {};
    w.window.__TAURI_IPC__ = {};
  });

  it("fetches system fonts via get_system_font_families", async () => {
    const families = makeSystemFontFamilies();
    invokeMock.mockResolvedValueOnce(families);

    const loaded = await fetchSystemFontFamilies();
    expect(invokeMock).toHaveBeenCalledWith("get_system_font_families", {});
    expect(loaded).toEqual(families);
  });

  it("lists open source fonts via list_open_source_fonts", async () => {
    const fonts = makeOpenSourceFonts();
    invokeMock.mockResolvedValueOnce(fonts);

    const loaded = await listOpenSourceFonts();
    expect(invokeMock).toHaveBeenCalledWith("list_open_source_fonts", {});
    expect(loaded).toEqual(fonts);
  });

  it("starts open source download via start_open_source_font_download", async () => {
    const snapshot = makeSnapshot();
    invokeMock.mockResolvedValueOnce(snapshot);

    const loaded = await startOpenSourceFontDownload(" inter ");
    expect(invokeMock).toHaveBeenCalledWith("start_open_source_font_download", {
      fontId: " inter ",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("font_id");
    expect(loaded).toEqual(snapshot);
  });

  it("fetches download snapshot via get_open_source_font_download_snapshot", async () => {
    const snapshot = makeSnapshot();
    invokeMock.mockResolvedValueOnce(snapshot);

    const loaded = await fetchOpenSourceFontDownloadSnapshot("inter");
    expect(invokeMock).toHaveBeenCalledWith("get_open_source_font_download_snapshot", {
      fontId: "inter",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("font_id");
    expect(loaded).toEqual(snapshot);
  });

  it("cancels download via cancel_open_source_font_download", async () => {
    invokeMock.mockResolvedValueOnce(true);

    const ok = await cancelOpenSourceFontDownload("inter");
    expect(invokeMock).toHaveBeenCalledWith("cancel_open_source_font_download", {
      fontId: "inter",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("font_id");
    expect(ok).toBe(true);
  });

  it("ensures font downloaded via ensure_open_source_font_downloaded", async () => {
    const font = makeDownloadedFont();
    invokeMock.mockResolvedValueOnce(font);

    const loaded = await ensureOpenSourceFontDownloaded("inter");
    expect(invokeMock).toHaveBeenCalledWith("ensure_open_source_font_downloaded", {
      fontId: "inter",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("font_id");
    expect(loaded).toEqual(font);
  });

  it("imports font via import_ui_font_file", async () => {
    const font = makeDownloadedFont();
    invokeMock.mockResolvedValueOnce(font);

    const loaded = await importUiFontFile(" /tmp/inter.ttf ");
    expect(invokeMock).toHaveBeenCalledWith("import_ui_font_file", {
      sourcePath: "/tmp/inter.ttf",
    });
    expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("source_path");
    expect(loaded).toEqual(font);
  });
});
