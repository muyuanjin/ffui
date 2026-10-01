import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueFfmpegJob, loadQueueStateLite, parseFfmpegCommand } from "@/lib/backend";
import contract from "../../src-tauri/tests/ffmpeg-command-input-contract.json";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, convertFileSrc: (path: string) => path }));

describe("FFmpeg queue command boundary", () => {
  beforeEach(() => invokeMock.mockReset());

  it.each(contract.valid)(
    "parses $id through canonical IPC without rewriting text or argv",
    async ({ command, args }) => {
      invokeMock.mockResolvedValueOnce(args);
      expect(await parseFfmpegCommand(command)).toEqual(args);
      expect(invokeMock).toHaveBeenCalledWith("parse_ffmpeg_command", { command });
    },
  );

  it.each([null, [], ["-i", 1], { args: ["-version"] }])("rejects an invalid parser response: %j", async (response) => {
    invokeMock.mockResolvedValueOnce(response);
    await expect(parseFfmpegCommand("ffmpeg -version")).rejects.toThrow("Invalid FFmpeg command parser response");
  });

  it("propagates parser diagnostics", async () => {
    invokeMock.mockRejectedValueOnce("Unclosed quote in FFmpeg command");
    await expect(parseFfmpegCommand('ffmpeg -i "broken')).rejects.toBe("Unclosed quote in FFmpeg command");
  });

  it("retains execution capability through the lightweight UI snapshot", async () => {
    invokeMock.mockResolvedValueOnce({
      snapshotRevision: 1,
      latestDeltaRevision: 0,
      jobs: [
        {
          id: "job-command",
          filename: "Analysis",
          type: "other",
          source: "manual",
          presetId: "",
          status: "paused",
          progress: 0,
          originalSizeMB: 0,
          executionMode: "transparent",
        },
      ],
    });
    const state = await loadQueueStateLite();
    expect(state.jobs[0]?.executionMode).toBe("transparent");
    expect(state.jobs[0]?.type).toBe("other");
    expect(state.jobs[0]).not.toHaveProperty("execution");
  });

  it("preserves ordered arguments, empty strings, duplicates and paths through IPC", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "job-command",
      filename: "Analysis",
      type: "other",
      source: "manual",
      presetId: "",
      status: "queued",
      progress: 0,
      originalSizeMB: 0,
      execution: { kind: "ffmpeg", invocation: { output: { kind: "transparent" } } },
    });
    const args = [
      "-i",
      "C:\\音乐\\track.flac",
      "-metadata",
      "",
      "-map",
      "0",
      "-map",
      "0",
      "-filter_complex",
      "[0:a]volume=0.5[a]",
      "-f",
      "null",
      "NUL",
    ];
    const job = await enqueueFfmpegJob({ name: "Analysis", args, workingDirectory: "D:\\输出" });
    expect(invokeMock).toHaveBeenCalledWith("enqueue_ffmpeg_job", {
      request: { name: "Analysis", args, workingDirectory: "D:\\输出" },
    });
    expect(job.executionMode).toBe("transparent");
    expect(job.type).toBe("other");
  });

  it("does not invent a working directory", async () => {
    invokeMock.mockResolvedValueOnce({});
    await enqueueFfmpegJob({ name: "Version", args: ["-version"] });
    expect(invokeMock).toHaveBeenCalledWith("enqueue_ffmpeg_job", {
      request: { name: "Version", args: ["-version"], workingDirectory: null },
    });
  });
});
