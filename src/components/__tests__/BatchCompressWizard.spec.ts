// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
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

const createPreset = (id: string, name: string, overrides: Partial<FFmpegPreset> = {}): FFmpegPreset => ({
  id,
  name,
  description: `${name} desc`,
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  ...overrides,
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

  it("预览输出的默认容器跟随当前选择的视频预设", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [
          createPreset("p1", "MP4 预设"),
          createPreset("p2", "MKV 预设", { container: { format: "matroska" } }),
        ],
        defaultVideoPresetId: "p2",
        initialConfig: buildBatchCompressDefaults({
          rootPath: "C:/videos",
          videoPresetId: "",
          outputPolicy: {
            container: { mode: "default" },
            directory: { mode: "sameAsInput" },
            filename: { suffix: ".compressed" },
            preserveFileTimes: false,
          },
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    await flushPromises();
    const previewOutput = wrapper.get('[data-testid="output-policy-preview-output"]').text();
    expect(previewOutput).toContain("input.compressed.mkv");
  });

  it("音频预设 SelectItem 不使用空字符串 value（静态模板校验，兼容 reka-ui 校验）", () => {
    const source = readFileSync(resolve(__dirname, "../BatchCompressWizard.vue"), "utf8");
    expect(source).not.toContain('<SelectItem value="">');
  });

  it("启用的媒体类型没有选中扩展名时不能开始扫描", () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p2",
        initialConfig: buildBatchCompressDefaults({
          rootPath: "C:/videos",
          videoFilter: { enabled: true, extensions: [] },
          imageFilter: { enabled: true, extensions: [] },
          audioFilter: { enabled: true, extensions: [] },
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    expect(runButton!.attributes("disabled")).toBeDefined();
  });

  it("启用视频但预设无效时不能开始扫描", () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: null,
        initialConfig: buildBatchCompressDefaults({
          rootPath: "C:/videos",
          videoPresetId: "missing-preset",
          videoFilter: { enabled: true, extensions: ["mp4"] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: false, extensions: [] },
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    expect(runButton!.attributes("disabled")).toBeDefined();
  });

  it("提交前会清洗数值字段为非负数", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p2",
        initialConfig: buildBatchCompressDefaults({
          rootPath: "C:/videos",
          minVideoSizeMB: -1,
          minImageSizeKB: Number.NaN,
          minAudioSizeKB: -500,
          minSavingAbsoluteMB: -7,
          videoFilter: { enabled: true, extensions: ["mp4"] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: false, extensions: [] },
          savingConditionType: "absoluteSize",
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    const submitted = emitted?.[0]?.[0];
    expect(submitted?.minVideoSizeMB).toBe(0);
    expect(submitted?.minImageSizeKB).toBe(0);
    expect(submitted?.minAudioSizeKB).toBe(0);
    expect(submitted?.minSavingAbsoluteMB).toBe(0);
  });

  it("未编辑时 initialConfig 异步更新会同步完整默认配置", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p1",
        initialConfig: buildBatchCompressDefaults({
          rootPath: "C:/initial",
          videoPresetId: "p1",
          replaceOriginal: true,
          minVideoSizeMB: 10,
          minImageSizeKB: 20,
          minAudioSizeKB: 30,
          savingConditionType: "ratio",
          minSavingRatio: 0.9,
          minSavingAbsoluteMB: 5,
          imageTargetFormat: "avif",
          videoFilter: { enabled: true, extensions: ["mp4"] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: false, extensions: [] },
          outputPolicy: {
            container: { mode: "default" },
            directory: { mode: "sameAsInput" },
            filename: { suffix: ".initial" },
            preserveFileTimes: false,
          },
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    await wrapper.setProps({
      initialConfig: buildBatchCompressDefaults({
        rootPath: "C:/async-defaults",
        videoPresetId: "p2",
        replaceOriginal: false,
        minVideoSizeMB: 111,
        minImageSizeKB: 222,
        minAudioSizeKB: 333,
        savingConditionType: "absoluteSize",
        minSavingRatio: 0.7,
        minSavingAbsoluteMB: 12,
        imageTargetFormat: "webp",
        videoFilter: { enabled: true, extensions: ["mkv"] },
        imageFilter: { enabled: true, extensions: ["png"] },
        audioFilter: { enabled: true, extensions: ["flac"] },
        outputPolicy: {
          container: { mode: "force", format: "mp4" },
          directory: { mode: "fixed", directory: "D:/out" },
          filename: { prefix: "new-", suffix: ".compressed" },
          preserveFileTimes: { modified: true },
        },
      }),
    });
    await nextTick();

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    const submitted = emitted?.[0]?.[0];
    expect(submitted?.rootPath).toBe("C:/async-defaults");
    expect(submitted?.videoPresetId).toBe("p2");
    expect(submitted?.replaceOriginal).toBe(false);
    expect(submitted?.minVideoSizeMB).toBe(111);
    expect(submitted?.minImageSizeKB).toBe(222);
    expect(submitted?.minAudioSizeKB).toBe(333);
    expect(submitted?.savingConditionType).toBe("absoluteSize");
    expect(submitted?.minSavingAbsoluteMB).toBe(12);
    expect(submitted?.imageTargetFormat).toBe("webp");
    expect(submitted?.videoFilter).toEqual({ enabled: true, extensions: ["mkv"] });
    expect(submitted?.imageFilter).toEqual({ enabled: true, extensions: ["png"] });
    expect(submitted?.audioFilter).toEqual({ enabled: true, extensions: ["flac"] });
    expect(submitted?.outputPolicy).toEqual({
      container: { mode: "force", format: "mp4" },
      directory: { mode: "fixed", directory: "D:/out" },
      filename: { prefix: "new-", suffix: ".compressed" },
      preserveFileTimes: { modified: true },
    });
  });

  it("preset 异步归一化不会阻止后到的 initialConfig 完整同步", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [],
        defaultVideoPresetId: null,
        initialConfig: undefined,
      },
      global: { plugins: [createI18nInstance()] },
    });

    await wrapper.setProps({
      presets: [...presets],
      defaultVideoPresetId: "p1",
    });
    await nextTick();

    await wrapper.setProps({
      initialConfig: buildBatchCompressDefaults({
        rootPath: "C:/loaded-defaults",
        videoPresetId: "p2",
        replaceOriginal: false,
        minVideoSizeMB: 111,
        minImageSizeKB: 222,
        minAudioSizeKB: 333,
        savingConditionType: "absoluteSize",
        minSavingAbsoluteMB: 12,
        imageTargetFormat: "webp",
        videoFilter: { enabled: true, extensions: ["mkv"] },
        imageFilter: { enabled: true, extensions: ["png"] },
        audioFilter: { enabled: true, extensions: ["flac"] },
        outputPolicy: {
          container: { mode: "force", format: "mp4" },
          directory: { mode: "fixed", directory: "D:/out" },
          filename: { prefix: "new-", suffix: ".compressed" },
          preserveFileTimes: { modified: true },
        },
      }),
    });
    await nextTick();

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    const submitted = emitted?.[0]?.[0];
    expect(submitted?.rootPath).toBe("C:/loaded-defaults");
    expect(submitted?.videoPresetId).toBe("p2");
    expect(submitted?.replaceOriginal).toBe(false);
    expect(submitted?.minVideoSizeMB).toBe(111);
    expect(submitted?.minImageSizeKB).toBe(222);
    expect(submitted?.minAudioSizeKB).toBe(333);
    expect(submitted?.savingConditionType).toBe("absoluteSize");
    expect(submitted?.minSavingAbsoluteMB).toBe(12);
    expect(submitted?.imageTargetFormat).toBe("webp");
    expect(submitted?.videoFilter).toEqual({ enabled: true, extensions: ["mkv"] });
    expect(submitted?.imageFilter).toEqual({ enabled: true, extensions: ["png"] });
    expect(submitted?.audioFilter).toEqual({ enabled: true, extensions: ["flac"] });
    expect(submitted?.outputPolicy).toEqual({
      container: { mode: "force", format: "mp4" },
      directory: { mode: "fixed", directory: "D:/out" },
      filename: { prefix: "new-", suffix: ".compressed" },
      preserveFileTimes: { modified: true },
    });
  });

  it("用户编辑后 initialConfig 异步更新不会覆盖已编辑配置", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p1",
        initialConfig: buildBatchCompressDefaults({
          rootPath: "C:/initial",
          videoPresetId: "p1",
          minVideoSizeMB: 10,
          videoFilter: { enabled: true, extensions: ["mp4"] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: false, extensions: [] },
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    await nextTick();
    const minVideoInput = wrapper.find('input[type="number"]');
    await minVideoInput.setValue("77");

    await wrapper.setProps({
      initialConfig: buildBatchCompressDefaults({
        rootPath: "C:/late-defaults",
        videoPresetId: "p2",
        minVideoSizeMB: 111,
        videoFilter: { enabled: true, extensions: ["mkv"] },
        imageFilter: { enabled: true, extensions: ["png"] },
        audioFilter: { enabled: true, extensions: ["flac"] },
      }),
    });
    await nextTick();

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    const submitted = emitted?.[0]?.[0];
    expect(submitted?.rootPath).toBe("C:/initial");
    expect(submitted?.videoPresetId).toBe("p1");
    expect(submitted?.minVideoSizeMB).toBe(77);
    expect(submitted?.videoFilter).toEqual({ enabled: true, extensions: ["mp4"] });
    expect(submitted?.imageFilter.enabled).toBe(false);
    expect(submitted?.audioFilter.enabled).toBe(false);
  });

  it("用户编辑后若当前路径为空，后到 initialConfig 仍可补路径", async () => {
    const wrapper = mount(BatchCompressWizard, {
      props: {
        presets: [...presets],
        defaultVideoPresetId: "p1",
        initialConfig: buildBatchCompressDefaults({
          rootPath: "",
          videoPresetId: "p1",
          minVideoSizeMB: 10,
          videoFilter: { enabled: true, extensions: ["mp4"] },
          imageFilter: { enabled: false, extensions: [] },
          audioFilter: { enabled: false, extensions: [] },
        }),
      },
      global: { plugins: [createI18nInstance()] },
    });

    await nextTick();
    const minVideoInput = wrapper.find('input[type="number"]');
    await minVideoInput.setValue("77");

    await wrapper.setProps({
      initialConfig: buildBatchCompressDefaults({
        rootPath: "C:/dropped-after-open",
        videoPresetId: "p2",
        minVideoSizeMB: 111,
        videoFilter: { enabled: true, extensions: ["mkv"] },
        imageFilter: { enabled: false, extensions: [] },
        audioFilter: { enabled: false, extensions: [] },
      }),
    });
    await nextTick();

    const runButton = wrapper.findAll("button").find((btn) => btn.text().includes("扫描并压缩"));
    expect(runButton).toBeTruthy();
    await runButton!.trigger("click");

    const emitted = wrapper.emitted("run") as Array<[BatchCompressConfig]> | undefined;
    const submitted = emitted?.[0]?.[0];
    expect(submitted?.rootPath).toBe("C:/dropped-after-open");
    expect(submitted?.videoPresetId).toBe("p1");
    expect(submitted?.minVideoSizeMB).toBe(77);
    expect(submitted?.videoFilter).toEqual({ enabled: true, extensions: ["mp4"] });
  });
});
