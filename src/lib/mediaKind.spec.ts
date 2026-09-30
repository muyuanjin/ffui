import { describe, expect, it } from "vitest";
import { mediaKindForPath, mediaTypeLabelKey } from "./mediaKind";

describe("mediaKindForPath", () => {
  it("分开识别音频、图片与视频，未知扩展名按视频处理", () => {
    expect(mediaKindForPath("C:/m/song.mp3")).toBe("audio");
    expect(mediaKindForPath("C:/m/song.FLAC")).toBe("audio");
    expect(mediaKindForPath("C:/m/cover.png")).toBe("image");
    expect(mediaKindForPath("C:/m/clip.mkv")).toBe("video");
    expect(mediaKindForPath("C:/m/clip.unknown")).toBe("video");
    expect(mediaKindForPath(null)).toBe("video");
  });
});

describe("mediaTypeLabelKey", () => {
  it("每一种媒体种类都有自己的文案键（音频不再显示为视频）", () => {
    expect(mediaTypeLabelKey("audio")).toBe("media.typeAudio");
    expect(mediaTypeLabelKey("image")).toBe("media.typeImage");
    expect(mediaTypeLabelKey("video")).toBe("media.typeVideo");
  });
});
