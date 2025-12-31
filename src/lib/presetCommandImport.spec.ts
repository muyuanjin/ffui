import { describe, it, expect } from "vitest";
import { buildFfmpegCommandFromStructured } from "@/lib/ffmpegCommand";
import { analyzeImportCommandLine, createCustomTemplatePresetFromAnalysis } from "./presetCommandImport";

describe("presetCommandImport", () => {
  it("marks a canonical structured preview command as editable", () => {
    const cmd = buildFfmpegCommandFromStructured({
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      mapping: { maps: ["0"] },
    });

    const analysis = analyzeImportCommandLine(cmd);
    expect(analysis.eligibility.custom).toBe(true);
    expect(analysis.eligibility.editable).toBe(true);
    expect(analysis.structuredPreset).toBeTruthy();
    expect(analysis.suggestedName).toBe("libx264 CRF 23");
  });

  it("supports -map_metadata/-map_chapters in structured imports", () => {
    const cmd = buildFfmpegCommandFromStructured({
      video: { encoder: "copy", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      mapping: { maps: ["0"], mapMetadataFromInputFileIndex: -1, mapChaptersFromInputFileIndex: -1 },
    });

    const analysis = analyzeImportCommandLine(cmd);
    expect(analysis.eligibility.custom).toBe(true);
    expect(analysis.eligibility.editable).toBe(true);
    expect(analysis.structuredPreset?.mapping?.mapMetadataFromInputFileIndex).toBe(-1);
    expect(analysis.structuredPreset?.mapping?.mapChaptersFromInputFileIndex).toBe(-1);
  });

  it("accepts -filter:v/-filter:a aliases when importing structured commands", () => {
    const cmd = buildFfmpegCommandFromStructured({
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "aac", bitrate: 192 },
      filters: { scale: "-2:720", afChain: "volume=1" },
      mapping: { maps: ["0"] },
    });

    const aliasCmd = cmd.replace(" -vf ", " -filter:v ").replace(" -af ", " -filter:a ");
    const analysis = analyzeImportCommandLine(aliasCmd);
    expect(analysis.eligibility.custom).toBe(true);
    expect(analysis.eligibility.editable).toBe(true);
  });

  it("forces custom import when an unsupported flag is present", () => {
    const cmd = `ffmpeg -i INPUT -map 0 -c:v libx264 -crf 23 -preset medium -c:a copy -foo bar OUTPUT`;
    const analysis = analyzeImportCommandLine(cmd);
    expect(analysis.eligibility.custom).toBe(true);
    expect(analysis.eligibility.editable).toBe(false);
    expect(analysis.reasons.join(" ")).toContain("-foo");
  });

  it("rejects commands that cannot form a runnable INPUT/OUTPUT template", () => {
    const cmd = `ffmpeg -c:v libx264 OUTPUT`;
    const analysis = analyzeImportCommandLine(cmd);
    expect(analysis.eligibility.custom).toBe(false);
    expect(analysis.eligibility.editable).toBe(false);
    expect(analysis.reasons.join(" ")).toContain("-i");
  });

  it("stores advanced template imports in args-only form", () => {
    const cmd = `ffmpeg -i INPUT -map 0 -c:v libx264 -crf 23 -preset medium -c:a copy OUTPUT`;
    const analysis = analyzeImportCommandLine(cmd);
    const preset = createCustomTemplatePresetFromAnalysis(analysis);
    expect(preset).toBeTruthy();
    expect(preset?.ffmpegTemplate?.trim().startsWith("ffmpeg ")).toBe(false);
    expect(preset?.ffmpegTemplate?.trim().startsWith("-i ")).toBe(true);
  });

  it("accepts ffmpeg.exe program tokens and still stores args-only templates", () => {
    const cmd = `"C:/Program Files/FFmpeg/bin/ffmpeg.exe" -hide_banner -i INPUT -map 0 -c:v libx264 -crf 23 OUTPUT`;
    const analysis = analyzeImportCommandLine(cmd);
    expect(analysis.eligibility.custom).toBe(true);
    const preset = createCustomTemplatePresetFromAnalysis(analysis);
    expect(preset).toBeTruthy();
    expect(preset?.ffmpegTemplate?.trim().startsWith("ffmpeg ")).toBe(false);
    expect(preset?.ffmpegTemplate?.trim().startsWith("-hide_banner ")).toBe(true);
  });
});
