import { describe, expect, it } from "vitest";

import { normalizeFpsExpressionForSave, parseFpsExpression } from "./fpsExpression";

describe("fpsExpression", () => {
  it("accepts decimal, rational, integer, and alias expressions", () => {
    expect(parseFpsExpression("29.97")).toMatchObject({ ok: true, expression: { value: "29.97" } });
    expect(parseFpsExpression("30000/1001")).toMatchObject({ ok: true, expression: { value: "30000/1001" } });
    expect(parseFpsExpression("60")).toMatchObject({ ok: true, expression: { value: "60" } });
    expect(parseFpsExpression("ntsc")).toMatchObject({ ok: true, expression: { value: "ntsc" } });
    expect(parseFpsExpression("ntsc_film")).toMatchObject({ ok: true, expression: { value: "ntsc_film" } });
  });

  it("canonicalizes compatibility aliases before save or command generation", () => {
    expect(parseFpsExpression("ntsc-film")).toMatchObject({
      ok: true,
      expression: { value: "24000/1001", kind: "alias" },
    });
    expect(normalizeFpsExpressionForSave("ntsc-film")).toBe("24000/1001");
  });

  it("normalizes legacy numeric fps to string", () => {
    expect(normalizeFpsExpressionForSave(29.97)).toBe("29.97");
  });

  it("formats legacy numeric fps without exponent notation", () => {
    expect(normalizeFpsExpressionForSave(1e-7)).toBe("0.0000001");
    expect(normalizeFpsExpressionForSave(1e21)).toBe("1000000000000000000000");
    expect(parseFpsExpression(1e-7)).toMatchObject({ ok: true, expression: { value: "0.0000001" } });
  });

  it("rejects unsafe or non-positive expressions", () => {
    for (const value of [
      "",
      "0",
      "-1",
      "1/0",
      "NaN",
      "Infinity",
      "fps=30",
      "30000 / 1001",
      "30,setpts=PTS",
      "source_fps",
      "toString",
      "constructor",
      "__proto__",
      "340282366920938463463374607431768211456/1",
      "1/340282366920938463463374607431768211456",
      `${"9".repeat(400)}/1`,
    ]) {
      expect(parseFpsExpression(value).ok, value).toBe(false);
    }
  });
});
