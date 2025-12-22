// @vitest-environment node
import { describe, it, expect } from "vitest";
import { analyzeImportCommandLine } from "./presetCommandImport";

describe("presetCommandImport input formats", () => {
  it("accepts markdown prompt prefixes like '> ' and '$ '", () => {
    const analysis1 = analyzeImportCommandLine("> ffmpeg -i INPUT -map 0 -c:v libx264 -crf 23 OUTPUT");
    expect(analysis1.eligibility.custom).toBe(true);

    const analysis2 = analyzeImportCommandLine("$ ffmpeg -i INPUT -map 0 -c:v libx264 -crf 23 OUTPUT");
    expect(analysis2.eligibility.custom).toBe(true);
  });

  it("accepts args-only commands and stores args-only templates", () => {
    const analysis = analyzeImportCommandLine("-i INPUT -map 0 -c:v libx264 -crf 23 -c:a copy OUTPUT");
    expect(analysis.eligibility.custom).toBe(true);
    expect(analysis.argsOnlyTemplate?.trim().startsWith("ffmpeg")).toBe(false);
  });

  it("accepts a quoted ffmpeg.exe program path and normalizes it", () => {
    const analysis = analyzeImportCommandLine(
      '"C:/Program Files/FFmpeg/bin/ffmpeg.exe" -hide_banner -i INPUT -map 0 -c:v libx264 -crf 23 OUTPUT',
    );
    expect(analysis.eligibility.custom).toBe(true);
    expect(analysis.normalizedTemplate.toLowerCase().startsWith("ffmpeg ")).toBe(true);
  });
});
