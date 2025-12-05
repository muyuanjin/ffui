import { describe, it, expect } from "vitest";
import { parseFfprobeJson } from "@/lib/mediaInfo";

describe("parseFfprobeJson", () => {
  it("extracts summary, format, and streams from ffprobe-style JSON", () => {
    const sample = {
      format: {
        filename: "C:/videos/sample.mp4",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        format_long_name: "QuickTime / MOV",
        duration: "120.5",
        size: "734003200",
        bit_rate: "4800000",
        tags: {
          title: "Sample Video",
          artist: "Test Artist",
        },
      },
      streams: [
        {
          index: 0,
          codec_type: "video",
          codec_name: "h264",
          codec_long_name:
            "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
          width: 1920,
          height: 1080,
          avg_frame_rate: "30000/1001",
          bit_rate: "4000000",
        },
        {
          index: 1,
          codec_type: "audio",
          codec_name: "aac",
          codec_long_name: "AAC (Advanced Audio Coding)",
          sample_rate: "48000",
          channels: 2,
          channel_layout: "stereo",
          bit_rate: "192000",
        },
      ],
      file: {
        path: "C:/videos/sample.mp4",
        exists: true,
        isFile: true,
        isDir: false,
        sizeBytes: 734003200,
        createdMs: 1_700_000_000_000,
        modifiedMs: 1_700_000_100_000,
        accessedMs: 1_700_000_200_000,
      },
    };

    const json = JSON.stringify(sample);
    const result = parseFfprobeJson(json);

    expect(result.summary).not.toBeNull();
    expect(result.summary?.durationSeconds).toBeCloseTo(120.5, 3);
    expect(result.summary?.width).toBe(1920);
    expect(result.summary?.height).toBe(1080);
    expect(result.summary?.videoCodec).toBe("h264");
    expect(result.summary?.audioCodec).toBe("aac");
    expect(result.summary?.sizeMB).toBeCloseTo(700, 0);

    expect(result.format?.formatName).toBe("mov,mp4,m4a,3gp,3g2,mj2");
    expect(result.format?.formatLongName).toBe("QuickTime / MOV");
    expect(result.format?.durationSeconds).toBeCloseTo(120.5, 3);
    expect(result.format?.sizeMB).toBeCloseTo(700, 0);
    expect(result.format?.bitRateKbps).toBeCloseTo(4800, 0);
    expect(result.format?.tags?.title).toBe("Sample Video");

    expect(result.streams.length).toBe(2);

    const video = result.streams.find((s) => s.codecType === "video");
    const audio = result.streams.find((s) => s.codecType === "audio");

    expect(video).toBeTruthy();
    expect(video?.width).toBe(1920);
    expect(video?.height).toBe(1080);
    expect(video?.frameRate).toBeGreaterThan(29);
    expect(video?.bitRateKbps).toBeCloseTo(4000, 0);

    expect(audio).toBeTruthy();
    expect(audio?.sampleRateHz).toBe(48000);
    expect(audio?.channels).toBe(2);
    expect(audio?.channelLayout).toBe("stereo");
    expect(audio?.bitRateKbps).toBeCloseTo(192, 0);

    expect(result.file).not.toBeNull();
    expect(result.file?.path).toBe("C:/videos/sample.mp4");
    expect(result.file?.exists).toBe(true);
    expect(result.file?.isFile).toBe(true);
    expect(result.file?.isDir).toBe(false);
    expect(result.file?.sizeBytes).toBe(734003200);
    expect(result.file?.createdMs).toBe(1_700_000_000_000);
    expect(result.file?.modifiedMs).toBe(1_700_000_100_000);
    expect(result.file?.accessedMs).toBe(1_700_000_200_000);

    // raw payload is preserved so callers can inspect additional fields.
    expect((result.raw as any)?.format?.filename).toBe("C:/videos/sample.mp4");
  });

  it("returns a safe fallback when JSON parsing fails", () => {
    const result = parseFfprobeJson("not-json");
    expect(result.summary).toBeNull();
    expect(result.format).toBeNull();
    expect(result.streams).toEqual([]);
    expect(result.file).toBeNull();
    expect(result.raw).toBeNull();
  });
});
