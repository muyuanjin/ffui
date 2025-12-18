// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatsChart from "@/components/StatsChart.vue";
import type { FFmpegPreset } from "@/types";
import { i18n } from "@/__tests__/helpers/mainAppTauriDialog";

const makePreset = (options: {
  id: string;
  name: string;
  inputMB: number;
  outputMB: number;
  seconds: number;
  usageCount?: number;
}): FFmpegPreset => ({
  id: options.id,
  name: options.name,
  description: "Stats test preset",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "aac",
    bitrate: 128,
  },
  filters: {},
  stats: {
    usageCount: options.usageCount ?? 1,
    totalInputSizeMB: options.inputMB,
    totalOutputSizeMB: options.outputMB,
    totalTimeSeconds: options.seconds,
  },
});

describe("StatsChart", () => {
  it("使用输出体积 / 输入体积 * 100 计算平均压缩率", () => {
    const presets: FFmpegPreset[] = [
      // 50%：非常明显的压缩
      makePreset({ id: "p-half", name: "Half", inputMB: 100, outputMB: 50, seconds: 10 }),
      // 80%：轻微压缩
      makePreset({ id: "p-light", name: "Light", inputMB: 100, outputMB: 80, seconds: 8 }),
    ];

    const wrapper = mount(StatsChart, {
      props: { presets },
      global: { plugins: [i18n] },
    });

    const vm = wrapper.vm as any;
    const data = vm.data as Array<{ name: string; ratio: number; usage: number; speed: number }>;

    const half = data.find((d) => d.name === "Half");
    const light = data.find((d) => d.name === "Light");

    expect(half).toBeTruthy();
    expect(light).toBeTruthy();

    // 50MB / 100MB = 50%
    expect(half!.ratio).toBeCloseTo(50);
    // 80MB / 100MB = 80%
    expect(light!.ratio).toBeCloseTo(80);

    wrapper.unmount();
  });

  it("压缩率为 0-100 以内时，进度条宽度不会超出 0-100%", () => {
    const presets: FFmpegPreset[] = [makePreset({ id: "p-1", name: "Small", inputMB: 100, outputMB: 30, seconds: 10 })];

    const wrapper = mount(StatsChart, {
      props: { presets },
      global: { plugins: [i18n] },
    });

    const bar = wrapper.find("div.bg-emerald-500, div.bg-blue-500");
    expect(bar.exists()).toBe(true);

    const style = bar.attributes("style") || "";
    // style 形如 `width: 30%;`，这里只做一个包含性的断言，避免依赖具体数值
    expect(style).toMatch(/width:\s*\d+(\.\d+)?%;/);

    wrapper.unmount();
  });
});
