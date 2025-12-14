// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyUiAppearanceToDocument,
  normalizeUiFontFamily,
  normalizeUiFontSizePercent,
  normalizeUiFontName,
  normalizeUiScalePercent,
  resolveUiFontFamilyStack,
} from "@/lib/uiAppearance";

describe("uiAppearance", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--ffui-ui-scale");
    document.documentElement.style.removeProperty("--ffui-ui-scale-inv");
    document.documentElement.style.removeProperty("--ffui-ui-font-family");
    document.documentElement.style.removeProperty("--ffui-ui-font-size-scale");
    document.documentElement.style.fontSize = "";
    document.body.style.fontFamily = "";
    document.body.style.fontSize = "";
    delete (document.documentElement as any).dataset.ffuiUiScale;
    delete (document.documentElement as any).dataset.ffuiUiFontFamily;
    delete (document.documentElement as any).dataset.ffuiUiFontSizePercent;
  });

  it("normalizes uiScalePercent with clamping and rounding", () => {
    expect(normalizeUiScalePercent(undefined)).toBe(100);
    expect(normalizeUiScalePercent("110")).toBe(110);
    expect(normalizeUiScalePercent(109.6)).toBe(110);
    expect(normalizeUiScalePercent(1000)).toBe(200);
    expect(normalizeUiScalePercent(10)).toBe(50);
    expect(normalizeUiScalePercent(NaN)).toBe(100);
  });

  it("normalizes uiFontFamily to supported values", () => {
    expect(normalizeUiFontFamily(undefined)).toBe("system");
    expect(normalizeUiFontFamily("sans")).toBe("sans");
    expect(normalizeUiFontFamily("mono")).toBe("mono");
    expect(normalizeUiFontFamily("unknown")).toBe("system");
  });

  it("normalizes uiFontSizePercent with clamping and rounding", () => {
    expect(normalizeUiFontSizePercent(undefined)).toBe(100);
    expect(normalizeUiFontSizePercent("110")).toBe(110);
    expect(normalizeUiFontSizePercent(109.6)).toBe(110);
    expect(normalizeUiFontSizePercent(1000)).toBe(200);
    expect(normalizeUiFontSizePercent(10)).toBe(60);
    expect(normalizeUiFontSizePercent(NaN)).toBe(100);
  });

  it("normalizes uiFontName as a non-empty trimmed string", () => {
    expect(normalizeUiFontName(undefined)).toBeNull();
    expect(normalizeUiFontName("")).toBeNull();
    expect(normalizeUiFontName("  Consolas  ")).toBe("Consolas");
  });

  it("resolves a stable CSS font stack", () => {
    expect(resolveUiFontFamilyStack("system")).toContain("system-ui");
    expect(resolveUiFontFamilyStack("sans")).toContain("ui-sans-serif");
    expect(resolveUiFontFamilyStack("mono")).toContain("ui-monospace");
  });

  it("applies CSS variables to documentElement", () => {
    applyUiAppearanceToDocument({ uiScalePercent: 110, uiFontSizePercent: 120, uiFontFamily: "mono" });
    expect(document.documentElement.style.getPropertyValue("--ffui-ui-scale")).toBe("1.1");
    expect(document.documentElement.style.getPropertyValue("--ffui-ui-scale-inv")).toBe("0.9090909090909091");
    expect(document.documentElement.style.getPropertyValue("--ffui-ui-font-family")).toContain("ui-monospace");
    expect(document.documentElement.style.getPropertyValue("--ffui-ui-font-size-scale")).toBe("1.2");
    expect(document.body.style.fontFamily).toContain("ui-monospace");
    expect(document.documentElement.style.fontSize).toBe("");
    expect(document.documentElement.dataset.ffuiUiScale).toBe("110");
    expect(document.documentElement.dataset.ffuiUiFontFamily).toBe("mono");
    expect(document.documentElement.dataset.ffuiUiFontSizePercent).toBe("120");
    expect(document.documentElement.dataset.ffuiUiScaleEngine).toBeTruthy();
  });

  it("prefers uiFontName over generic family", () => {
    applyUiAppearanceToDocument({ uiScalePercent: 100, uiFontFamily: "mono", uiFontName: "Consolas" });
    expect(document.documentElement.style.getPropertyValue("--ffui-ui-font-family")).toContain("Consolas");
  });
});
