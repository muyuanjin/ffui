// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { hasTauri } from "@/lib/backend.core";

describe("backend.core hasTauri", () => {
  beforeEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI_IPC__;
    delete (window as any).__TAURI__;
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI_IPC__;
    delete (window as any).__TAURI__;
  });

  it("returns false when no Tauri globals exist", () => {
    expect(hasTauri()).toBe(false);
  });

  it("returns true when __TAURI_INTERNALS__ exists (Tauri v2)", () => {
    (window as any).__TAURI_INTERNALS__ = {};
    expect(hasTauri()).toBe(true);
  });
});
