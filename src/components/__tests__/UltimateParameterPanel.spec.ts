import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import UltimateParameterPanel from "@/components/UltimateParameterPanel.vue";
import type { FFmpegPreset } from "@/types";

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
});

