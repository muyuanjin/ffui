import { describe, expect, it } from "vitest";
import type { OutputContainerPolicy } from "@/types/output-policy";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { outputMediaKindForExtension, resolveOutputContainerForExtension } from "./outputContainerPolicy";
import { previewOutputPathLocal } from "./outputPolicyPreview";
import contract from "../../src-tauri/tests/output-media-policy-contract.json";

describe("media-scoped output container contract", () => {
  it.each(contract.webmCases)("previews the resolved WebM output for $input / $videoCodec", (entry) => {
    const preset = {
      video: { encoder: entry.videoCodec },
      audio: { codec: entry.audioCodec },
      advancedEnabled: "template" in entry,
      ffmpegTemplate: "template" in entry ? entry.template : undefined,
    } as any;
    const policy = {
      ...DEFAULT_OUTPUT_POLICY,
      container: { mode: "byMedia", video: "webm", audio: "mp3" } as OutputContainerPolicy,
    };
    expect(previewOutputPathLocal(`C:/videos/${entry.input}`, policy, { preset })).toBe(
      `C:/videos/input.compressed.${entry.extension}`,
    );
  });
  const container = contract.container as OutputContainerPolicy;
  it.each(contract.cases)("plans $input using only its resource type", (entry) => {
    const filename = entry.input.split("\\").pop()!;
    const extension = filename.includes(".") ? filename.split(".").pop()! : "";
    expect(outputMediaKindForExtension(extension) ?? "other").toBe(entry.type);
    expect(resolveOutputContainerForExtension(container, extension)).toEqual(
      entry.muxer ? { mode: "force", format: entry.extension } : { mode: "default" },
    );
    const preset = { container: { format: "mp4" } } as any;
    expect(previewOutputPathLocal(entry.input, { ...DEFAULT_OUTPUT_POLICY, container }, { preset })).toMatch(
      new RegExp(`\\.${entry.extension}$`),
    );
  });
  it.each(contract.legacy)("preserves an explicit unified format $format", ({ format }) => {
    const legacy: OutputContainerPolicy = { mode: "force", format };
    expect(legacy).toEqual({ mode: "force", format });
    expect(resolveOutputContainerForExtension(legacy, "mp4")).toEqual(legacy);
  });
  it("does not apply an audio choice to video or image files and preserves unset policy", () => {
    const audioOnly: OutputContainerPolicy = { mode: "byMedia", audio: "mp3" };
    expect(resolveOutputContainerForExtension(audioOnly, "mp4")).toEqual({ mode: "default" });
    expect(resolveOutputContainerForExtension(audioOnly, "png")).toEqual({ mode: "default" });
    for (const mode of ["default", "keepInput"] as const) {
      expect(resolveOutputContainerForExtension({ mode }, "wav")).toEqual({ mode });
    }
  });
});
