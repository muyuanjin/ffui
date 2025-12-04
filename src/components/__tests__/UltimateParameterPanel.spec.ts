import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import UltimateParameterPanel from "@/components/UltimateParameterPanel.vue";
import type { FFmpegPreset } from "@/types";

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
  messages: { en: {} },
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
});
