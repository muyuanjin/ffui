// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>(async () => ({
  date: "2025-01-01",
  activeHours: Array.from({ length: 24 }, () => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) =>
    payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload),
  convertFileSrc: (path: string) => path,
}));

import { fetchTranscodeActivityToday } from "@/lib/backend";

describe("backend transcode activity contract", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    (window as any).__TAURI_IPC__ = true;
  });

  it("uses get_transcode_activity_today command", async () => {
    await fetchTranscodeActivityToday();
    expect(invokeMock).toHaveBeenCalledWith("get_transcode_activity_today");
  });
});

