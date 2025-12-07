/**
 * 图表数据缓冲区工具
 *
 * 提供数据平滑和固定窗口缓冲功能，用于优化图表显示效果
 */

// 简单的指数移动平均平滑，用来压制 I/O 抖动带来的"蛆动感"
// 降低平滑因子，提高响应速度，同时保持一定的平滑效果
export const DEFAULT_SMOOTH_ALPHA = 0.25;

// 图表数据窗口大小常量
export const MINI_CHART_WINDOW = 20; // 迷你图表显示20个数据点
export const GPU_CHART_WINDOW = 40; // GPU图表显示40个数据点

/**
 * 使用指数移动平均算法平滑数据序列
 *
 * @param values - 原始数据数组
 * @param alpha - 平滑因子 (0-1)，越大越接近原始值，越小越平滑
 * @returns 平滑后的数据数组
 */
export function smoothEma(values: number[], alpha: number = DEFAULT_SMOOTH_ALPHA): number[] {
  if (values.length === 0) return [];
  const result = new Array<number>(values.length);
  result[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

/**
 * 创建固定长度的数据缓冲区
 *
 * 用于保持图表时间轴稳定，避免数据点数量变化导致的图表抖动
 *
 * @param data - 输入数据数组
 * @param windowSize - 目标窗口大小，默认为 MINI_CHART_WINDOW
 * @returns 固定长度的数据数组
 */
export const createFixedBuffer = (data: number[], windowSize: number = MINI_CHART_WINDOW): number[] => {
  if (data.length >= windowSize) {
    return data.slice(-windowSize);
  }
  // 数据不足时，用0填充前面的部分
  const buffer = new Array(windowSize).fill(0);
  data.forEach((val, idx) => {
    buffer[windowSize - data.length + idx] = val;
  });
  return buffer;
};
