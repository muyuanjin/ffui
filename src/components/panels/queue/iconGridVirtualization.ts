import type { QueueListItem } from "@/composables";

export type IconGridSize = "small" | "medium" | "large";

export const ICON_GRID_GAP_PX = 12; // Tailwind `gap-3` = 0.75rem = 12px

export const getIconGridMinColumnWidthPx = (size: IconGridSize): number => {
  if (size === "large") return 340;
  if (size === "medium") return 260;
  return 200;
};

export const computeIconGridColumns = (viewportWidthPx: number, size: IconGridSize): number => {
  const width = Math.max(0, Math.floor(viewportWidthPx));
  const minColWidth = getIconGridMinColumnWidthPx(size);
  const numerator = width + ICON_GRID_GAP_PX;
  const denominator = minColWidth + ICON_GRID_GAP_PX;
  if (denominator <= 0) return 1;
  return Math.max(1, Math.floor(numerator / denominator));
};

export type IconGridRow = {
  index: number;
  items: QueueListItem[];
};

export const buildIconGridRows = (items: QueueListItem[], columns: number): IconGridRow[] => {
  const cols = Math.max(1, Math.floor(columns));
  const rowCount = Math.ceil(items.length / cols);
  const rows: IconGridRow[] = new Array(rowCount);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const start = rowIndex * cols;
    const end = Math.min(items.length, start + cols);
    rows[rowIndex] = { index: rowIndex, items: items.slice(start, end) };
  }

  return rows;
};
