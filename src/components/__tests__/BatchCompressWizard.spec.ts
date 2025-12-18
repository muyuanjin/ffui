// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import BatchCompressWizard from "@/components/BatchCompressWizard.vue";
import zhCN from "@/locales/zh-CN";
import type { FFmpegPreset, BatchCompressConfig } from "@/types";
import { buildBatchCompressDefaults } from "../../__tests__/helpers/batchCompressDefaults";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Slider 依赖 ResizeObserver，测试环境补齐最小 polyfill
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const createPreset = (id: string, name: string): FFmpegPreset => ({
  id,
  name,
  description: `${name} desc`,
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
});

const createI18nInstance = () =>
  createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: { "zh-CN": zhCN as any },
  });

describe("BatchCompressWizard 默认预设", () => {
  const presets = [createPreset("p1", "预设一"), createPreset("p2", "预设二")];

  it("点击遮罩空白处会触发 cancel，点击内容不会", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p2",
        initialConfig: buildBatchCompressDefaults({ rootPath: "C:/videos" }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    await wrapper.find(".bg-background").trigger("click");
    expect(wrapper.emitted("cancel")).toBeFalsy();

    await wrapper.find(".fixed.inset-0").trigger("click");
    expect(wrapper.emitted("cancel")?.length).toBe(1);
  });

  it("未显式指定时使用主界面默认视频预设", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p2",
        initialConfig: buildBatchCompressDefaults({ rootPath: "C:/videos" }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    expect(emitted?.[0]?.[0].videoPresetId).toBe("p2");
  });

  it("保留 initialConfig 中已指定的视频预设", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p2",
        initialConfig: buildBatchCompressDefaults({ rootPath: "C:/videos", videoPresetId: "p1" }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    expect(emitted?.[0]?.[0].videoPresetId).toBe("p1");
  });

  it("音频预设 SelectItem 不使用空字符串 value（静态模板校验，兼容 reka-ui 校验）", () => {
    const source = readFileSync(resolve(__dirname, "../BatchCompressWizard.vue"), "utf8");
    expect(source).not.toContain('<SelectItem value="">');
  });
});
