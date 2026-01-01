import { collapseSameXPointsByAverage } from "./points";

export { collapseSameXPointsByAverage };

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export const interpolateY = (points: { x: number; y: number }[], x: number): number => {
  if (points.length === 0) return NaN;
  // vq_results data occasionally contains duplicate bitrate points (same x),
  // sometimes even with duplicate (x,y) entries. Collapse consecutive same-x
  // points by averaging y to keep interpolation stable.
  const collapsed = collapseSameXPointsByAverage(points);

  if (collapsed.length === 1) return collapsed[0]!.y;
  if (x <= collapsed[0]!.x) return collapsed[0]!.y;
  if (x >= collapsed[collapsed.length - 1]!.x) return collapsed[collapsed.length - 1]!.y;

  for (let i = 1; i < collapsed.length; i += 1) {
    const left = collapsed[i - 1]!;
    const right = collapsed[i]!;
    if (x <= right.x) {
      const span = right.x - left.x;
      if (span <= 0) return right.y;
      const t = (x - left.x) / span;
      return left.y + (right.y - left.y) * t;
    }
  }
  return collapsed[collapsed.length - 1]!.y;
};
