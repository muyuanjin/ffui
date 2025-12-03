// This test only guards the generated CSS; skip TS checking to avoid pulling
// in Node typings into the main frontend type-checking pipeline.
// @ts-nocheck

import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("ScrollArea CSS guardrails", () => {
  it("does not globally force native scrollbars on all Reka ScrollArea viewports", () => {
    const css = fs.readFileSync("src/index.css", "utf8");

    // We should only opt into native scrollbars via the scoped helper class,
    // not by overriding all [data-reka-scroll-area-viewport] elements.
    expect(css).toContain(".reka-native-scrollbars [data-reka-scroll-area-viewport]");
    expect(css).not.toMatch(/^\s*\[data-reka-scroll-area-viewport]/m);
  });
});
