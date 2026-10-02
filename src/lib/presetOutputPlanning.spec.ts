import { describe, expect, it } from "vitest";
import { inferPresetOutputKind, previewOutputPathLocal } from "./outputPolicyPreview";
import type { FFmpegPreset, OutputContainerPolicy } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import contract from "../../src-tauri/tests/preset-output-planning-contract.json";

describe("preset target output planning contract", () => {
  it.each(contract.cases)("resolves $kind output for $input / $template", (entry) => {
    const preset = {
      advancedEnabled: true,
      ffmpegTemplate: entry.template,
      outputKind: "declared" in entry ? entry.declared : undefined,
    } as FFmpegPreset;
    expect(inferPresetOutputKind(preset, entry.input.split(".").pop()!) ?? "other").toBe(entry.kind);
    const container: OutputContainerPolicy = { mode: "byMedia", video: "mkv", audio: "mp3", image: "bmp" };
    expect(
      previewOutputPathLocal(`C:/资源/${entry.input}`, { ...DEFAULT_OUTPUT_POLICY, container }, { preset }),
    ).toMatch(new RegExp(`\\.${entry.extension}$`));
    if ("defaultExtension" in entry) {
      expect(previewOutputPathLocal(`C:/资源/${entry.input}`, DEFAULT_OUTPUT_POLICY, { preset })).toMatch(
        new RegExp(`\\.${entry.defaultExtension}$`),
      );
    }
  });
  it("uses the mapped audio output of a structured preset with video input", () => {
    const preset = { mapping: { maps: ["0:a:0?"] } } as FFmpegPreset;
    expect(inferPresetOutputKind(preset, "mp4")).toBe("audio");
  });
});
