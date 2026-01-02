import { describe, it, expect } from "vitest";
import { formatMetricNumber, formatMetricRange } from "./presetRadarHelpers";

describe("presetRadarHelpers formatting", () => {
  it("formatMetricNumber uses fixed decimals and returns '—' for invalid inputs", () => {
    expect(formatMetricNumber(94.61778, 2)).toBe("94.62");
    expect(formatMetricNumber(undefined, 2)).toBe("—");
    expect(formatMetricNumber(NaN, 2)).toBe("—");
  });

  it("formatMetricRange formats main value with the requested precision", () => {
    expect(formatMetricRange({ value: 94.61778 }, 2)).toBe("94.62");
  });

  it("formatMetricRange includes min/max using the same precision", () => {
    expect(formatMetricRange({ value: 94.61778, min: 94, max: 95 }, 2)).toBe("94.62 (94.00–95.00)");
  });
});
