// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick, reactive } from "vue";
import UltimateParameterPanel from "@/components/UltimateParameterPanel.vue";
import PresetContainerTab from "@/components/preset-editor/PresetContainerTab.vue";
import { Select } from "@/components/ui/select";
import en from "@/locales/en";
import type { ContainerConfig, FFmpegPreset } from "@/types";

// reka-ui 的 Slider 依赖 ResizeObserver，这里在测试环境中提供一个最小 mock。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as any).ResizeObserver =
  (globalThis as any).ResizeObserver || ResizeObserverMock;

const i18n = createI18n({
  legacy: false,
  locale: "en",
  // 使用真实的英文文案，避免测试过程中出现多条 i18n 缺失 key 的告警。
  messages: { en: en as any },
});

const makeBasePreset = (): FFmpegPreset => ({
  id: "p-test",
  name: "Test Preset",
  description: "Used in UltimateParameterPanel tests",
  video: {
    encoder: "libx264",
    rateControl: "crf",
    qualityValue: 23,
    preset: "medium",
  },
  audio: {
    codec: "copy",
  },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("UltimateParameterPanel", () => {
  it("renders a CRF-based preview command for a simple x264 preset", () => {
    const preset = makeBasePreset();

    const wrapper = mount(UltimateParameterPanel, {
      props: {
        initialPreset: preset,
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();

    // Basic structure: ffmpeg -i INPUT -c:v libx264 -crf 23 ... OUTPUT
    expect(text).toContain("ffmpeg");
    expect(text).toContain("-i INPUT");
    expect(text).toContain("-c:v libx264");
    expect(text).toContain("-crf 23");
    expect(text).toContain("OUTPUT");
  });

  it("emits bitrate-based ffmpeg flags when using VBR + two-pass fields", () => {
    const preset: FFmpegPreset = {
      ...makeBasePreset(),
      video: {
        encoder: "libx264",
        rateControl: "vbr",
        qualityValue: 23,
        preset: "slow",
        bitrateKbps: 3000,
        maxBitrateKbps: 4000,
        bufferSizeKbits: 6000,
        pass: 2,
      },
    };

    const wrapper = mount(UltimateParameterPanel, {
      props: {
        initialPreset: preset,
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();

    // For VBR + pass 2 we expect bitrate flags but no CRF/CQ flag.
    expect(text).toContain("-b:v 3000k");
    expect(text).toContain("-maxrate 4000k");
    expect(text).toContain("-bufsize 6000k");
    expect(text).toContain("-pass 2");
    expect(text).not.toContain("-crf ");
    expect(text).not.toContain("-cq ");
  });

  it("includes global, timeline, mapping, container and hardware flags when present", () => {
    const preset: FFmpegPreset = {
      ...makeBasePreset(),
      global: {
        overwriteBehavior: "overwrite",
        logLevel: "error",
        hideBanner: true,
        enableReport: true,
      },
      input: {
        seekMode: "input",
        seekPosition: "00:00:10",
        durationMode: "duration",
        duration: "5",
        accurateSeek: true,
      },
      mapping: {
        maps: ["0:v:0", "0:a:0"],
        metadata: ["title=Test"],
        dispositions: ["0:v:0 default"],
      },
      subtitles: {
        strategy: "drop",
      },
      container: {
        format: "mp4",
        movflags: ["faststart", "frag_keyframe"],
      },
      hardware: {
        hwaccel: "cuda",
        hwaccelDevice: "cuda:0",
        hwaccelOutputFormat: "cuda",
        bitstreamFilters: ["h264_mp4toannexb"],
      },
    };

    const wrapper = mount(UltimateParameterPanel, {
      props: {
        initialPreset: preset,
      },
      global: {
        plugins: [i18n],
      },
    });

    const text = wrapper.text();

    expect(text).toContain("-y");
    expect(text).toContain("-loglevel error");
    expect(text).toContain("-hide_banner");
    expect(text).toContain("-report");
    expect(text).toContain("-ss 00:00:10");
    expect(text).toContain("-t 5");
    expect(text).toContain("-map 0:v:0");
    expect(text).toContain("-map 0:a:0");
    expect(text).toContain("-metadata title=Test");
    expect(text).toContain("-disposition 0:v:0 default");
    expect(text).toContain("-sn");
    expect(text).toContain("-f mp4");
    expect(text).toContain("-movflags faststart+frag_keyframe");
    expect(text).toContain("-hwaccel cuda");
    expect(text).toContain("-hwaccel_device cuda:0");
    expect(text).toContain("-hwaccel_output_format cuda");
    expect(text).toContain("-bsf h264_mp4toannexb");
  });

  it("allows resetting container format back to auto inference", async () => {
    const container = reactive<ContainerConfig>({
      format: "mp4",
      movflags: [],
    });

    const wrapper = mount(PresetContainerTab, {
      props: { container },
      global: {
        plugins: [i18n],
      },
    });

    const select = wrapper.getComponent(Select);
    select.vm.$emit("update:modelValue", "__auto__");
    await nextTick();

    expect(container.format).toBeUndefined();
  });

  it("preserves NVENC/AV1 smart preset HQ tuning and AQ fields when saving without parameter changes", async () => {
    const smartPreset: FFmpegPreset = {
      id: "smart-av1-nvenc-hq-constqp18",
      name: "AV1 NVENC HQ ConstQP18",
      description: "RTX 40+/Ada near-lossless AV1 NVENC preset",
      video: {
        encoder: "av1_nvenc",
        rateControl: "constqp",
        qualityValue: 18,
        preset: "p7",
        tune: "hq",
        pixFmt: "p010le",
        bRefMode: "each",
        rcLookahead: 32,
        bf: 3,
        spatialAq: true,
        temporalAq: true,
      } as any,
      audio: {
        codec: "aac",
        bitrate: 320,
        loudnessProfile: "ebuR128",
        truePeakDb: -1.0,
      } as any,
      filters: {},
      container: null as any,
      subtitles: null as any,
      hardware: null as any,
      stats: {
        usageCount: 0,
        totalInputSizeMB: 0,
        totalOutputSizeMB: 0,
        totalTimeSeconds: 0,
      },
      isSmartPreset: true,
    };

    const emitted: FFmpegPreset[] = [];

    const wrapper = mount(UltimateParameterPanel, {
      props: {
        initialPreset: smartPreset,
        onSave: (preset: FFmpegPreset) => emitted.push(preset),
      },
      global: {
        plugins: [i18n],
      },
    });

    // 直接点击“更新”按钮，不修改任何编码参数。
    const saveButton = wrapper
      .findAll("button")
      .find((btn) => btn.text().includes("Update Preset"));
    expect(saveButton).toBeTruthy();
    await saveButton!.trigger("click");

    expect(emitted.length).toBe(1);
    const saved = emitted[0];

    // 编码器与速率控制模式保持不变。
    expect(saved.video.encoder).toBe("av1_nvenc");
    expect(saved.video.rateControl).toBe("constqp");
    expect(saved.video.qualityValue).toBe(18);

    // 关键调优参数不会在“仅打开并保存”时被弱化或丢弃。
    expect((saved.video as any).tune).toBe("hq");
    expect((saved.video as any).bRefMode).toBe("each");
    expect((saved.video as any).rcLookahead).toBe(32);
    expect((saved.video as any).spatialAq).toBe(true);
    expect((saved.video as any).temporalAq).toBe(true);

    // 智能预设标记在参数未变动的情况下应继续保留。
    expect(saved.isSmartPreset).toBe(true);
  });
});
