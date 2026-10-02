import { describe, expect, it } from "vitest";
import { planManualPresetGroups } from "./manualPresetRouting";
import type { FFmpegPreset } from "@/types";

const presets = ["video", "audio", "image"].map((id) => ({ id }) as FFmpegPreset);
const files = ["C:\\资源\\视频.mp4", "C:/资源/音频.flac", "C:/资源/封面.jpg", "C:/资源/unknown"];
describe("manual preset input routing", () => {
  it("applies a unified audio preset to video, audio, image and unknown inputs", () => {
    expect(planManualPresetGroups(files, presets, "audio", { mode: "unified" })).toEqual([
      { presetId: "audio", filenames: files },
    ]);
  });
  it("selects per-input presets and keeps an explicit unified fallback", () => {
    expect(
      planManualPresetGroups(files, presets, "video", { mode: "byMedia", video: "audio", image: "image" }),
    ).toEqual([
      { presetId: "audio", filenames: [files[0]] },
      { presetId: "video", filenames: [files[1]] },
      { presetId: "image", filenames: [files[2]] },
      { presetId: "video", filenames: [files[3]] },
    ]);
  });
  it("reports a missing configured preset instead of silently substituting the fallback", () => {
    expect(() => planManualPresetGroups(files, presets, "video", { mode: "byMedia", audio: "deleted" })).toThrow(
      "deleted",
    );
  });
});
