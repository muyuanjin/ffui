const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * 1024 * 1024;

type TimedPoint = {
  timestamp: number;
};

export const CHART_ANIMATION = {
  animation: false,
  animationDuration: 0,
  animationDurationUpdate: 0,
} as const;

export function latestChartPoints<T extends TimedPoint>(points: readonly T[], maxPoints: number): T[] {
  return points.length > maxPoints ? points.slice(points.length - maxPoints) : [...points];
}

export function timeCategoryAxis(points: readonly TimedPoint[]) {
  return {
    type: "category",
    data: points.map((p) => new Date(p.timestamp).toLocaleTimeString()),
    boundaryGap: false,
    axisLabel: { show: false },
  };
}

export function percentYAxis() {
  return {
    type: "value",
    min: 0,
    max: 100,
    axisLabel: { formatter: "{value}%" },
  };
}

export function gigabyteYAxis() {
  return {
    type: "value",
    axisLabel: {
      formatter(val: number) {
        return `${(val / BYTES_PER_GIB).toFixed(0)}G`;
      },
    },
  };
}

export function megabytesPerSecondYAxis() {
  return {
    type: "value",
    axisLabel: {
      formatter(val: number) {
        return `${(val / BYTES_PER_MIB).toFixed(0)} MB/s`;
      },
    },
  };
}

export function percentTooltipValue(digits: number) {
  return (value: number) => `${value.toFixed(digits)}%`;
}

export function gigabyteTooltipValue(value: number) {
  return `${(value / BYTES_PER_GIB).toFixed(2)} GB`;
}

export function megabytesPerSecondTooltipValue(value: number) {
  return `${(value / BYTES_PER_MIB).toFixed(2)} MB/s`;
}
