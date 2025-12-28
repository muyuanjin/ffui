import { describe, it, expect } from "vitest";
import {
  highlightJsonTokensAsync,
  parseFfprobeJsonAsyncLite,
  parseJsonAsync,
  stringifyJsonAsync,
} from "@/lib/asyncJson";

describe("asyncJson helpers", () => {
  it("parseJsonAsync parses JSON (worker optional)", async () => {
    const parsed = await parseJsonAsync<{ a: number; b: string }>('{"a":1,"b":"x"}');
    expect(parsed).toEqual({ a: 1, b: "x" });
  });

  it("stringifyJsonAsync serializes JSON (worker optional)", async () => {
    const raw = await stringifyJsonAsync({ a: 1, b: "x" }, 2);
    expect(raw).toContain('\n  "a": 1,');
    expect(raw).toContain('\n  "b": "x"');
  });

  it("parseFfprobeJsonAsyncLite returns parsed analysis with raw dropped", async () => {
    const sample = {
      format: { duration: "1.5", size: "1048576" },
      streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1" }],
      file: { path: "C:/videos/sample.mp4", exists: true, isFile: true, isDir: false, sizeBytes: 1048576 },
    };
    const json = JSON.stringify(sample);
    const parsed = await parseFfprobeJsonAsyncLite(json);
    expect(parsed.summary?.durationSeconds).toBeCloseTo(1.5, 3);
    expect(parsed.summary?.width).toBe(1920);
    expect(parsed.file?.path).toBe("C:/videos/sample.mp4");
    expect(parsed.raw).toBeNull();
  });

  it("highlightJsonTokensAsync returns tokens for raw JSON", async () => {
    const tokens = await highlightJsonTokensAsync('{"a":1,"b":"x"}');
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.map((t) => t.text).join("")).toContain('"a"');
  });
});
