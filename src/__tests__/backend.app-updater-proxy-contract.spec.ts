// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => (payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload)),
  convertFileSrc: (path: string) => path,
}));

import { prepareAppUpdaterProxy } from "@/lib/backend";

describe("backend app updater proxy contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (window as any).__TAURI_IPC__ = {};
  });

  it("resolves updater proxy via prepare_app_updater_proxy", async () => {
    invokeMock.mockResolvedValueOnce("http://127.0.0.1:7890");

    const proxy = await prepareAppUpdaterProxy();
    expect(invokeMock).toHaveBeenCalledWith("prepare_app_updater_proxy");
    expect(proxy).toBe("http://127.0.0.1:7890");
  });
});
