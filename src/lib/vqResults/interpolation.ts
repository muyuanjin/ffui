export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export const interpolateY = (points: { x: number; y: number }[], x: number): number => {
  if (points.length === 0) return NaN;
  if (points.length === 1) return points[0]!.y;
  if (x <= points[0]!.x) return points[0]!.y;
  if (x >= points[points.length - 1]!.x) return points[points.length - 1]!.y;

  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1]!;
    const right = points[i]!;
    if (x <= right.x) {
      const span = right.x - left.x;
      if (span <= 0) return right.y;
      const t = (x - left.x) / span;
      return left.y + (right.y - left.y) * t;
    }
  }
  return points[points.length - 1]!.y;
};
