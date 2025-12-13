// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) =>
    payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload),
  convertFileSrc: (path: string) => path,
}));

import { fetchAppUpdaterCapabilities } from "@/lib/backend";

describe("backend app updater capabilities contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (window as any).__TAURI_IPC__ = {};
  });

  it("fetches updater capabilities via get_app_updater_capabilities", async () => {
    invokeMock.mockResolvedValueOnce({ configured: true });

    const caps = await fetchAppUpdaterCapabilities();
    expect(invokeMock).toHaveBeenCalledWith("get_app_updater_capabilities");
    expect(caps).toEqual({ configured: true });
  });
});

