import { describe, it, expect } from "vitest";
import { getSystemFontSuggestions, resolveSystemFontFamilyName, type SystemFontFamily } from "./systemFontSearch";

describe("systemFontSearch", () => {
  it("matches localized names and resolves to the primary family name", () => {
    const fonts: SystemFontFamily[] = [
      { primary: "Example Primary", names: ["示例字体", "Example Primary"] },
      { primary: "Other Font", names: ["其他字体"] },
    ];

    const suggestions = getSystemFontSuggestions({
      fonts,
      query: "示例",
      focused: true,
      max: 20,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.value).toBe("Example Primary");
    expect(suggestions[0]?.label).toContain("示例字体");

    expect(
      resolveSystemFontFamilyName({
        fonts,
        input: "示例字体",
      }),
    ).toBe("Example Primary");
  });
});
