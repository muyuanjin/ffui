import { beforeEach, describe, expect, it } from "vitest";
import { __test, highlightFfmpegCommand, highlightFfmpegCommandTokens } from "./rendering";

describe("ffmpegCommand rendering cache", () => {
  beforeEach(() => {
    __test.resetHighlightCache();
  });

  it("reuses HighlightToken[] for identical command strings", () => {
    const command =
      'ffmpeg -hide_banner -nostdin -y -progress pipe:2 -i "INPUT" -c:v libx264 -preset medium -crf 23 "OUTPUT"';
    const a = highlightFfmpegCommandTokens(command);
    const b = highlightFfmpegCommandTokens(command);
    expect(b).toBe(a);
  });

  it("separates cache keys when program overrides differ", () => {
    const command = 'ffmpeg -i "INPUT" -c:v libx264 "OUTPUT"';
    const a = highlightFfmpegCommandTokens(command, { programOverrides: { ffmpeg: "C:/ffmpeg-a.exe" } });
    const b = highlightFfmpegCommandTokens(command, { programOverrides: { ffmpeg: "C:/ffmpeg-a.exe" } });
    const c = highlightFfmpegCommandTokens(command, { programOverrides: { ffmpeg: "C:/ffmpeg-b.exe" } });

    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("reuses highlighted HTML for identical command strings", () => {
    const command = 'ffmpeg -i "INPUT" -c:v libx264 "OUTPUT"';
    const a = highlightFfmpegCommand(command);
    const b = highlightFfmpegCommand(command);
    expect(b).toBe(a);
  });

  it("evicts old entries (bounded cache) when many unique commands are highlighted", () => {
    const firstCommand = 'ffmpeg -i "C:/in/0000.mp4" -c:v libx264 "C:/out/0000.mp4"';
    const first = highlightFfmpegCommandTokens(firstCommand);

    for (let i = 1; i <= 310; i += 1) {
      const cmd = `ffmpeg -i "C:/in/${String(i).padStart(4, "0")}.mp4" -c:v libx264 "C:/out/${String(i).padStart(
        4,
        "0",
      )}.mp4"`;
      highlightFfmpegCommandTokens(cmd);
    }

    const after = highlightFfmpegCommandTokens(firstCommand);
    expect(after).not.toBe(first);
  });
});
