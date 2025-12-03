import { describe, it, expect } from "vitest";
import { highlightFfmpegCommand, normalizeFfmpegTemplate } from "./ffmpegCommand";

describe("ffmpegCommand utilities", () => {
  it("renders highlighted command without changing the plain text content", () => {
    const cmd =
      'ffmpeg -hide_banner -nostdin -i "C:/videos/input.mp4" -c:v libx264 -crf 23 "C:/videos/output.mp4" -y';

    const html = highlightFfmpegCommand(cmd);
    // Should contain spans for options / paths.
    expect(html).toContain("text-blue-400");
    expect(html).toContain("text-amber-400");

    // Strip tags and decode the basic HTML entities we use in highlighting.
    const stripTags = html.replace(/<[^>]+>/g, "");
    const decode = (value: string) =>
      value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
    const text = decode(stripTags);
    expect(text).toBe(cmd);
  });

  it("normalizes a simple one-input-one-output command into INPUT/OUTPUT template", () => {
    const input =
      'ffmpeg -hide_banner -nostdin -i "C:/videos/input.mp4" -c:v libx264 -crf 23 "C:/videos/output.mp4" -y';

    const result = normalizeFfmpegTemplate(input);
    expect(result.inputReplaced).toBe(true);
    expect(result.outputReplaced).toBe(true);
    expect(result.template).toContain('"INPUT"');
    expect(result.template).toContain('"OUTPUT"');
    expect(result.template.startsWith("ffmpeg ")).toBe(true);
  });

  it("falls back to last non-option token as OUTPUT when no explicit placeholder is present", () => {
    const input = "ffmpeg -i INPUT.mp4 -c:v libx264 -crf 23 OUTPUT.mkv";
    const result = normalizeFfmpegTemplate(input);
    expect(result.inputReplaced).toBe(true);
    expect(result.outputReplaced).toBe(true);
    expect(result.template).toContain("INPUT");
    expect(result.template).toContain("OUTPUT");
  });

  it("handles commands that already use INPUT/OUTPUT placeholders", () => {
    const input =
      'ffmpeg -hide_banner -nostdin -i INPUT -c:v libx264 -crf 23 OUTPUT -y';
    const result = normalizeFfmpegTemplate(input);
    expect(result.template).toBe(input);
    expect(result.inputReplaced).toBe(true);
    expect(result.outputReplaced).toBe(true);
  });
});
