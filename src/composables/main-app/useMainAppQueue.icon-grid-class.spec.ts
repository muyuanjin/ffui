import { describe, expect, it } from "vitest";

import { getQueueIconGridClass } from "./useMainAppQueue";

describe("getQueueIconGridClass", () => {
  it("uses auto-fit minmax so maximized windows fill naturally", () => {
    expect(getQueueIconGridClass("icon-small")).toContain(
      "grid-cols-[repeat(auto-fill,minmax(",
    );
    expect(getQueueIconGridClass("icon-medium")).toContain(
      "grid-cols-[repeat(auto-fill,minmax(",
    );
    expect(getQueueIconGridClass("icon-large")).toContain(
      "grid-cols-[repeat(auto-fill,minmax(",
    );
  });

  it("sets different minimum widths per icon size", () => {
    expect(getQueueIconGridClass("icon-small")).toContain(
      "minmax(200px,1fr)",
    );
    expect(getQueueIconGridClass("icon-medium")).toContain(
      "minmax(260px,1fr)",
    );
    expect(getQueueIconGridClass("icon-large")).toContain(
      "minmax(340px,1fr)",
    );
  });

  it("falls back to the smallest grid for non-icon modes", () => {
    expect(getQueueIconGridClass("detail")).toContain("minmax(200px,1fr)");
    expect(getQueueIconGridClass("compact")).toContain("minmax(200px,1fr)");
  });
});
