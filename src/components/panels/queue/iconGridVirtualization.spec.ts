import { describe, expect, it } from "vitest";
import type { QueueListItem } from "@/composables";
import { buildIconGridRows, computeIconGridColumns } from "./iconGridVirtualization";

describe("iconGridVirtualization", () => {
  it("computes at least 1 column", () => {
    expect(computeIconGridColumns(0, "small")).toBe(1);
    expect(computeIconGridColumns(-100, "large")).toBe(1);
  });

  it("computes more columns as viewport grows", () => {
    const small1 = computeIconGridColumns(200, "small");
    const small2 = computeIconGridColumns(800, "small");
    expect(small2).toBeGreaterThanOrEqual(small1);
  });

  it("splits items into rows by column count", () => {
    const items: QueueListItem[] = Array.from({ length: 7 }, (_, i) => ({
      kind: "job",
      job: { id: `job-${i}` } as any,
    }));
    const rows = buildIconGridRows(items, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0].items).toHaveLength(3);
    expect(rows[1].items).toHaveLength(3);
    expect(rows[2].items).toHaveLength(1);
  });
});
