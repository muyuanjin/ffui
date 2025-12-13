import { describe, it, expect } from "vitest";
import { progressiveMergeSort } from "@/composables/queue/progressiveSort";

describe("progressiveMergeSort", () => {
  it("yields during large merges and produces the same ordering as a full sort", async () => {
    const items = Array.from({ length: 2000 }, (_, idx) => 2000 - idx);
    const expected = items.slice().sort((a, b) => a - b);

    let yieldCount = 0;
    const partialLengths: number[] = [];

    const result = await progressiveMergeSort(items, {
      compare: (a, b) => a - b,
      chunkSize: 200,
      initialBatchSize: 200,
      yieldEveryItems: 100,
      yieldFn: async () => {
        yieldCount += 1;
      },
      onPartial: (partial) => {
        partialLengths.push(partial.length);
      },
      isCancelled: () => false,
    });

    expect(result).toEqual(expected);
    expect(yieldCount).toBeGreaterThan(0);
    expect(partialLengths[0]).toBe(200);
    expect(partialLengths[partialLengths.length - 1]).toBe(2000);
  });
});
