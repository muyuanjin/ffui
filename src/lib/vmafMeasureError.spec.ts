import { describe, expect, it } from "vitest";
import { parseVmafMeasureError } from "@/lib/vmafMeasureError";

describe("parseVmafMeasureError", () => {
  it("parses missing encoder errors (libsvtav1 example)", () => {
    const raw = [
      "测量失败: ffmpeg cannot use video encoder 'libsvtav1' (required by preset 'smart-av1-balanced');",
      "ffmpeg=C:\\Users\\muyuanjin\\AppData\\Roaming\\com.muyuanjin.ffui\\tools\\ffmpeg.exe:",
      "ffmpeg encoder probe failed: encoder=libsvtav1",
      "[vost#0:0 @ 00000231699d96c0] Unknown encoder 'libsvtav1'",
    ].join(" ");

    expect(parseVmafMeasureError(raw)).toEqual({
      kind: "missing_encoder",
      encoder: "libsvtav1",
      presetId: "smart-av1-balanced",
      ffmpegPath: "C:\\Users\\muyuanjin\\AppData\\Roaming\\com.muyuanjin.ffui\\tools\\ffmpeg.exe",
      raw: expect.stringContaining("Unknown encoder 'libsvtav1'"),
    });
  });

  it("parses missing libvmaf filter errors", () => {
    const raw = "Measure failed: No such filter: 'libvmaf'";
    expect(parseVmafMeasureError(raw)).toEqual({
      kind: "missing_filter",
      filter: "libvmaf",
      ffmpegPath: undefined,
      raw: "No such filter: 'libvmaf'",
    });
  });
});
