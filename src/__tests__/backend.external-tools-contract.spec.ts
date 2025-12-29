// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>(async () => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => (payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload)),
  convertFileSrc: (path: string) => path,
}));

import { fetchExternalToolStatusesCached, refreshExternalToolStatusesAsync } from "@/lib/backend";

describe("backend external tools contract", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("uses get_external_tool_statuses_cached for startup-safe snapshots", async () => {
    await fetchExternalToolStatusesCached();
    expect(invokeMock).toHaveBeenCalledWith("get_external_tool_statuses_cached");
  });

  it("passes canonical camelCase payload keys for manual remote refresh", async () => {
    await refreshExternalToolStatusesAsync({ remoteCheck: true, manualRemoteCheck: true });
    expect(invokeMock).toHaveBeenCalledWith(
      "refresh_external_tool_statuses_async",
      expect.objectContaining({
        remoteCheck: true,
        manualRemoteCheck: true,
      }),
    );
  });
});
