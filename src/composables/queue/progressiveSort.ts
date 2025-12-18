export type YieldFn = () => Promise<void>;

export interface ProgressiveMergeSortOptions<T> {
  compare: (a: T, b: T) => number;
  chunkSize: number;
  initialBatchSize: number;
  yieldEveryItems: number;
  yieldFn: YieldFn;
  onPartial: (partial: T[]) => void;
  isCancelled: () => boolean;
}

/**
 * Chunked, yielding merge-sort via incremental "fold merge":
 * - split into chunks
 * - sort each chunk
 * - merge into an accumulated sorted list, yielding periodically
 *
 * This keeps per-slice work bounded without requiring a single blocking
 * `Array.prototype.sort()` over the full dataset.
 */
export async function progressiveMergeSort<T>(
  items: readonly T[],
  options: ProgressiveMergeSortOptions<T>,
): Promise<T[]> {
  const { compare, chunkSize, initialBatchSize, yieldEveryItems, yieldFn, onPartial, isCancelled } = options;

  if (!items.length) return [];

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  const first = chunks[0] ?? [];
  first.sort(compare);

  let acc = first;
  let displayLimit = Math.min(initialBatchSize, acc.length);
  onPartial(acc.slice(0, displayLimit));

  for (let idx = 1; idx < chunks.length; idx += 1) {
    if (isCancelled()) return acc;
    const chunk = chunks[idx] ?? [];
    chunk.sort(compare);
    await yieldFn();
    if (isCancelled()) return acc;

    displayLimit = Math.min(items.length, displayLimit + chunkSize);

    const merged: T[] = new Array(acc.length + chunk.length);
    let i = 0;
    let j = 0;
    let k = 0;

    while (i < acc.length || j < chunk.length) {
      if (i >= acc.length) {
        merged[k++] = chunk[j++] as T;
      } else if (j >= chunk.length) {
        merged[k++] = acc[i++] as T;
      } else {
        const a = acc[i] as T;
        const b = chunk[j] as T;
        if (compare(a, b) <= 0) {
          merged[k++] = a;
          i += 1;
        } else {
          merged[k++] = b;
          j += 1;
        }
      }

      if (k % yieldEveryItems === 0) {
        await yieldFn();
        if (isCancelled()) return acc;
      }
    }

    acc = merged;
    onPartial(acc.slice(0, displayLimit));
  }

  onPartial(acc);
  return acc;
}
