import { describe, expect, it } from "vitest";

import { applyDownloadedUiFont, startOpenSourceFontDownload } from "./uiFonts";

describe("uiFonts (non-tauri)", () => {
  it("applyDownloadedUiFont() is a no-op when Tauri is not available", async () => {
    await expect(
      applyDownloadedUiFont({
        id: "font-1",
        familyName: "Test Font",
        path: "C:/fonts/test.ttf",
        format: "ttf",
      }),
    ).resolves.toBeUndefined();
  });

  it("startOpenSourceFontDownload() returns null when Tauri is not available", async () => {
    await expect(startOpenSourceFontDownload("inter")).resolves.toBeNull();
  });
});

