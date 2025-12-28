// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn<(cmd: string, payload?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: (cmd: string, payload?: Record<string, unknown>) => invokeMock(cmd, payload),
    convertFileSrc: (path: string) => path,
  };
});

import { exitAppNow, exitAppWithAutoWait, resetExitPrompt } from "@/lib/backend.app-exit";

describe("backend app exit contract", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("resetExitPrompt invokes reset_exit_prompt without payload", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resetExitPrompt();
    expect(invokeMock).toHaveBeenCalledWith("reset_exit_prompt", undefined);
  });

  it("resetExitPrompt is a no-op when Tauri is unavailable", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    await resetExitPrompt();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("exitAppNow invokes exit_app_now without payload", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await exitAppNow();
    expect(invokeMock).toHaveBeenCalledWith("exit_app_now", undefined);
  });

  it("exitAppNow is a no-op when Tauri is unavailable", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    await exitAppNow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("exitAppWithAutoWait invokes exit_app_with_auto_wait without payload", async () => {
    const fake = { requestedJobCount: 1, completedJobCount: 1, timedOutJobCount: 0, timeoutSeconds: 5 };
    invokeMock.mockResolvedValueOnce(fake);
    const result = await exitAppWithAutoWait();
    expect(invokeMock).toHaveBeenCalledWith("exit_app_with_auto_wait", undefined);
    expect(result).toEqual(fake);
  });

  it("exitAppWithAutoWait throws when Tauri is unavailable", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    await expect(exitAppWithAutoWait()).rejects.toThrow(/requires Tauri/);
  });
});
