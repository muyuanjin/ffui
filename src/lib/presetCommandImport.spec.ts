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
});
