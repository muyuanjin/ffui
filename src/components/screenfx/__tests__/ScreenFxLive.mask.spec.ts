// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ScreenFxLive masks", () => {
  it("does not rely on CSS mask-image so streams remain visible across webviews", () => {
    const source = readFileSync(resolve(__dirname, "../ScreenFxLive.vue"), "utf8");

    expect(source).not.toContain("mask-image");
    expect(source).not.toContain("-webkit-mask-image");
  });
});
