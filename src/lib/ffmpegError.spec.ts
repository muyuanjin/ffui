import { describe, expect, it } from "vitest";
import { parseFfmpegError } from "@/lib/ffmpegError";

describe("parseFfmpegError", () => {
  it("parses missing encoder errors (libsvtav1 example)", () => {
    const raw = [
      "Transcode failed: ffmpeg cannot use video encoder 'libsvtav1' (required by preset 'smart-av1-balanced');",
      "ffmpeg=C:\\Users\\muyuanjin\\AppData\\Roaming\\com.muyuanjin.ffui\\tools\\ffmpeg.exe:",
      "ffmpeg encoder probe failed: encoder=libsvtav1",
      "[vost#0:0 @ 00000231699d96c0] Unknown encoder 'libsvtav1'",
    ].join(" ");

    expect(parseFfmpegError(raw)).toEqual({
      kind: "missing_encoder",
      encoder: "libsvtav1",
      presetId: "smart-av1-balanced",
      ffmpegPath: "C:\\Users\\muyuanjin\\AppData\\Roaming\\com.muyuanjin.ffui\\tools\\ffmpeg.exe",
      raw: expect.stringContaining("Unknown encoder 'libsvtav1'"),
    });
  });

  it("parses missing filters", () => {
    expect(parseFfmpegError("Error: No such filter: 'libvmaf'")).toEqual({
      kind: "missing_filter",
      filter: "libvmaf",
      ffmpegPath: undefined,
      raw: "No such filter: 'libvmaf'",
    });
  });

  it("parses missing decoders", () => {
    expect(parseFfmpegError("Failed: Unknown decoder 'h264_cuvid'")).toEqual({
      kind: "missing_decoder",
      decoder: "h264_cuvid",
      ffmpegPath: undefined,
      raw: "Unknown decoder 'h264_cuvid'",
    });
  });

  it("parses missing shared libraries", () => {
    expect(
      parseFfmpegError("Error while loading shared libraries: libcuda.so.1: cannot open shared object file"),
    ).toEqual({
      kind: "missing_library",
      library: "libcuda.so.1",
      raw: "Error while loading shared libraries: libcuda.so.1: cannot open shared object file",
    });
  });

  it("parses input-not-found errors", () => {
    expect(parseFfmpegError("E: No such file or directory")).toEqual({
      kind: "input_not_found",
      raw: "E: No such file or directory",
    });
  });

  it("parses permission errors", () => {
    expect(parseFfmpegError("Permission denied")).toEqual({
      kind: "permission_denied",
      raw: "Permission denied",
    });
  });
});
