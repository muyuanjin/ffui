// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { installNativeContextMenuGuard } from "@/lib/nativeContextMenuGuard";

describe("installNativeContextMenuGuard", () => {
  it("prevents the native context menu by default", () => {
    const cleanup = installNativeContextMenuGuard();
    try {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("removes the listener on cleanup", () => {
    const cleanup = installNativeContextMenuGuard();
    cleanup();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
