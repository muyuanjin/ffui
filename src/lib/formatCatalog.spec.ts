import { describe, it, expect } from "vitest";
import { FORMAT_CATALOG, filterFormatCatalog } from "./formatCatalog";

describe("formatCatalog", () => {
  it("matches formats by extension with or without leading dot", () => {
    const m2ts1 = filterFormatCatalog(FORMAT_CATALOG, "m2ts").some((e) => e.value === "m2ts");
    const m2ts2 = filterFormatCatalog(FORMAT_CATALOG, ".m2ts").some((e) => e.value === "m2ts");
    expect(m2ts1).toBe(true);
    expect(m2ts2).toBe(true);
  });
});
