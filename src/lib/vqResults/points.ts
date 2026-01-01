export const collapseSameXPointsByAverage = <T extends { x: number; y: number }>(
  points: T[],
): Array<{ x: number; y: number }> => {
  if (points.length <= 1) return points as Array<{ x: number; y: number }>;

  const out: Array<{ x: number; y: number }> = [];
  let curX = points[0]!.x;
  let sum = points[0]!.y;
  let count = 1;

  for (let i = 1; i < points.length; i += 1) {
    const p = points[i]!;
    if (p.x === curX) {
      sum += p.y;
      count += 1;
      continue;
    }
    out.push({ x: curX, y: sum / count });
    curX = p.x;
    sum = p.y;
    count = 1;
  }

  out.push({ x: curX, y: sum / count });
  return out;
};

export const collapseSameXPoints = collapseSameXPointsByAverage;
