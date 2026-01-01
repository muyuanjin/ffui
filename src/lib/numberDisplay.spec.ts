import { describe, it, expect } from "vitest";
import { toFixedDisplay } from "./numberDisplay";

describe("toFixedDisplay", () => {
  it("returns text + numeric value using the same rounding", () => {
    const out = toFixedDisplay(94.996, 2);
    expect(out).toEqual({ text: "95.00", value: 95 });
  });

  it("returns null for non-finite numbers", () => {
    expect(toFixedDisplay(NaN, 2)).toBeNull();
    expect(toFixedDisplay(Infinity, 2)).toBeNull();
  });

  it("clamps digits to a safe range", () => {
    expect(toFixedDisplay(1.2345, 999)?.text).toBe("1.234500");
    expect(toFixedDisplay(1.2345, -10)?.text).toBe("1");
  });
});
