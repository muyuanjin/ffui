// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import PresetAudioTab from "@/components/preset-editor/PresetAudioTab.vue";
import en from "@/locales/en";
import type { AudioConfig, SubtitlesConfig } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

describe("PresetAudioTab", () => {
  it("切换到AAC编码时，应该设置默认的比特率和响度配置", async () => {
    // 初始状态：音频编码为 copy，没有比特率和响度配置
    const audio: AudioConfig = {
      codec: "copy",
    };

    const subtitles: SubtitlesConfig = {
      strategy: "keep",
    };

    const wrapper = mount(PresetAudioTab, {
      props: {
        audio,
        subtitles,
        isCopyEncoder: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    // 验证初始状态
    expect(audio.codec).toBe("copy");
    expect(audio.bitrate).toBeUndefined();
    expect(audio.loudnessProfile).toBeUndefined();

    // 查找并点击 AAC 按钮
    const buttons = wrapper.findAll("button");
    const aacButton = buttons.find((btn) => {
      const text = btn.text();
      return text.includes("AAC") || text.includes("aac");
    });

    expect(aacButton).toBeDefined();
    await aacButton!.trigger("click");

    // 验证切换后的状态
    expect(audio.codec).toBe("aac");
    expect(audio.bitrate).toBe(320);
    expect(audio.loudnessProfile).toBe("ebuR128");
  });

  it("切换到AAC时，如果已有比特率和响度配置，不应该覆盖", async () => {
    // 初始状态：音频编码为 copy，但已经有比特率和响度配置
    const audio: AudioConfig = {
      codec: "copy",
      bitrate: 192,
      loudnessProfile: "cnBroadcast",
    };

    const subtitles: SubtitlesConfig = {
      strategy: "keep",
    };

    const wrapper = mount(PresetAudioTab, {
      props: {
        audio,
        subtitles,
        isCopyEncoder: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    // 查找并点击 AAC 按钮
    const buttons = wrapper.findAll("button");
    const aacButton = buttons.find((btn) => {
      const text = btn.text();
      return text.includes("AAC") || text.includes("aac");
    });

    await aacButton!.trigger("click");

    // 验证：应该保留原有的配置
    expect(audio.codec).toBe("aac");
    expect(audio.bitrate).toBe(192);
    expect(audio.loudnessProfile).toBe("cnBroadcast");
  });

  it("AAC模式下，比特率选择器应该显示当前值", async () => {
    const audio: AudioConfig = {
      codec: "aac",
      bitrate: 320,
    };

    const subtitles: SubtitlesConfig = {
      strategy: "keep",
    };

    const wrapper = mount(PresetAudioTab, {
      props: {
        audio,
        subtitles,
        isCopyEncoder: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    // 等待组件渲染完成
    await wrapper.vm.$nextTick();

    // 验证比特率选择器存在且有值
    const text = wrapper.text();
    expect(text).toContain("320");
  });

  it("AAC模式下，响度配置的输入框应该显示placeholder或实际值", async () => {
    const audio: AudioConfig = {
      codec: "aac",
      bitrate: 320,
      loudnessProfile: "ebuR128",
      // 不设置 targetLufs 和 truePeakDb，应该显示 placeholder
    };

    const subtitles: SubtitlesConfig = {
      strategy: "keep",
    };

    const wrapper = mount(PresetAudioTab, {
      props: {
        audio,
        subtitles,
        isCopyEncoder: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.vm.$nextTick();

    // 查找目标响度输入框
    const inputs = wrapper.findAll("input[type='number']");
    expect(inputs.length).toBeGreaterThan(0);

    // 验证输入框有 placeholder（ebuR128 的默认值）
    const targetLufsInput = inputs.find((input) => {
      const placeholder = input.attributes("placeholder");
      return placeholder === "-23";
    });
    expect(targetLufsInput).toBeDefined();

    // 验证真峰值输入框有 placeholder
    const truePeakInput = inputs.find((input) => {
      const placeholder = input.attributes("placeholder");
      return placeholder === "-1";
    });
    expect(truePeakInput).toBeDefined();
  });

  it("AAC模式下，设置实际的响度值后应该显示该值而不是placeholder", async () => {
    const audio: AudioConfig = {
      codec: "aac",
      bitrate: 320,
      loudnessProfile: "ebuR128",
      targetLufs: -20,
      truePeakDb: -2,
    };

    const subtitles: SubtitlesConfig = {
      strategy: "keep",
    };

    const wrapper = mount(PresetAudioTab, {
      props: {
        audio,
        subtitles,
        isCopyEncoder: false,
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.vm.$nextTick();

    // 查找数字输入框
    const inputs = wrapper.findAll("input[type='number']");

    // 验证目标响度输入框显示实际值
    const targetLufsInput = inputs.find((input) => {
      const el = input.element as HTMLInputElement;
      return el.value === "-20";
    });
    expect(targetLufsInput).toBeDefined();

    // 验证真峰值输入框显示实际值
    const truePeakInput = inputs.find((input) => {
      const el = input.element as HTMLInputElement;
      return el.value === "-2";
    });
    expect(truePeakInput).toBeDefined();
  });
});
