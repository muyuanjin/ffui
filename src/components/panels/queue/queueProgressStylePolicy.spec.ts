import { describe, it, expect } from "vitest";
import { coerceQueueProgressStyleForPerf } from "./queueProgressStylePolicy";

describe("coerceQueueProgressStyleForPerf", () => {
  it("keeps style when heavy effects are allowed", () => {
    expect(coerceQueueProgressStyleForPerf("bar", true)).toBe("bar");
    expect(coerceQueueProgressStyleForPerf("card-fill", true)).toBe("card-fill");
    expect(coerceQueueProgressStyleForPerf("ripple-card", true)).toBe("ripple-card");
  });

  it("downgrades repaint-heavy styles to bar when heavy effects are disallowed", () => {
    expect(coerceQueueProgressStyleForPerf("card-fill", false)).toBe("bar");
    expect(coerceQueueProgressStyleForPerf("ripple-card", false)).toBe("bar");
  });

  it("keeps bar when heavy effects are disallowed", () => {
    expect(coerceQueueProgressStyleForPerf("bar", false)).toBe("bar");
  });
});
