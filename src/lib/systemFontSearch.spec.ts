import { describe, expect, it } from "vitest";

import { getSystemFontSuggestions, resolveSystemFontFamilyName } from "./systemFontSearch";

describe("systemFontSearch", () => {
  it("matches Chinese alias queries like 微软雅黑", () => {
    const suggestions = getSystemFontSuggestions({
      fonts: ["Arial", "Microsoft YaHei", "SimSun"],
      query: "微软雅黑",
      focused: true,
    });
    expect(suggestions.some((s) => s.value === "Microsoft YaHei")).toBe(true);
    expect(suggestions.find((s) => s.value === "Microsoft YaHei")?.label).toContain("微软雅黑");
  });

  it("returns empty suggestions when not focused", () => {
    const suggestions = getSystemFontSuggestions({
      fonts: ["Microsoft YaHei"],
      query: "yahei",
      focused: false,
    });
    expect(suggestions).toEqual([]);
  });

  it("returns first entries when query is empty", () => {
    const suggestions = getSystemFontSuggestions({
      fonts: ["A", "B", "C"],
      query: "",
      focused: true,
    });
    expect(suggestions.map((s) => s.value)).toEqual(["A", "B", "C"]);
  });

  it("resolves exact alias input to an existing canonical font name", () => {
    const resolved = resolveSystemFontFamilyName({
      fonts: ["Arial", "Microsoft YaHei"],
      input: "微软雅黑",
    });
    expect(resolved).toBe("Microsoft YaHei");
  });
});
