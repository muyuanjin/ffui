// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ParameterWizard from "@/components/ParameterWizard.vue";
import en from "@/locales/en";
import type { FFmpegPreset } from "@/types";

// reka-ui 的下拉组件依赖 ResizeObserver，这里在测试环境中提供一个最小 mock。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;

// 注意：vue-i18n 的类型推导对大型 messages 对象会产生“Type instantiation is excessively deep”。
// 在测试里使用宽松 schema，避免在这里耗尽类型推导深度。
const i18n = (createI18n as any)({
  legacy: false,
  locale: "en",
  // 在测试环境内也挂载完整的英文文案，避免反复出现 intlify “Not found” 告警。
  messages: { en: en as any },
});
const t = (key: string) => String(i18n.global.t(key));

describe("ParameterWizard", () => {
  it("does not carry over x264 tune film when saving an NVENC preset", async () => {
    const emitted: FFmpegPreset[] = [];

    const wrapper = mount(ParameterWizard, {
      props: {
        initialPreset: null,
        onSave: (preset: FFmpegPreset) => emitted.push(preset),
      },
      global: {
        plugins: [i18n],
      },
    });

    // Step 1: preset kind selection (default: structured). Move into the basics step.
    const nextLabel = t("common.next");
    const nextFromKind = wrapper.findAll("button").find((btn) => btn.text().includes(nextLabel));
    expect(nextFromKind).toBeTruthy();
    await nextFromKind!.trigger("click");

    // Step 1: choose the fast NVENC recipe to switch encoder to hevc_nvenc.
    const fastNvencLabel = t("presetEditor.recipes.fastTranscode");
    const recipeButtons = wrapper.findAll("button");
    const fastNvencButton = recipeButtons.find((btn) => btn.text().includes(fastNvencLabel));
    expect(fastNvencButton).toBeTruthy();
    await fastNvencButton!.trigger("click");

    // Recipe 会把 step 设置为 3（视频步骤），这里依次点击 Next 直到最后一步再保存。
    for (let i = 0; i < 3; i += 1) {
      const nextButton = wrapper.findAll("button").find((btn) => btn.text().includes(nextLabel));
      expect(nextButton).toBeTruthy();
      await nextButton!.trigger("click");
    }

    // Final step: click the save button which triggers handleSave.
    const saveLabel = t("presetEditor.actions.save");
    const saveButton = wrapper.findAll("button").find((btn) => btn.text().includes(saveLabel));
    expect(saveButton).toBeTruthy();
    await saveButton!.trigger("click");

    expect(emitted.length).toBe(1);
    const preset = emitted[0];

    expect(preset.video.encoder).toBe("hevc_nvenc");
    // 关键断言：保存到后端的 NVENC 预设里不应该再包含 x264 的 tune film。
    expect("tune" in preset.video).toBe(false);
  });

  it("defaults AAC audio to 320k with EBU loudness profile when selected in the wizard", async () => {
    const emitted: FFmpegPreset[] = [];

    const wrapper = mount(ParameterWizard, {
      props: {
        initialPreset: null,
        onSave: (preset: FFmpegPreset) => emitted.push(preset),
      },
      global: {
        plugins: [i18n],
      },
    });

    const nextLabel = t("common.next");
    // 依次点击 Next 进入到音频步骤（第 5 步：Kind → Basics → Video → Filters → Audio）。
    for (let i = 0; i < 4; i += 1) {
      const nextButton = wrapper.findAll("button").find((btn) => btn.text().includes(nextLabel));
      expect(nextButton).toBeTruthy();
      await nextButton!.trigger("click");
    }

    const aacLabel = t("presetEditor.audio.aacTitle");
    const aacButton = wrapper.findAll("button").find((btn) => btn.text().includes(aacLabel));
    expect(aacButton).toBeTruthy();
    await aacButton!.trigger("click");

    // 继续到最后一步并保存预设。
    const nextButton = wrapper.findAll("button").find((btn) => btn.text().includes(nextLabel));
    expect(nextButton).toBeTruthy();
    await nextButton!.trigger("click");

    const saveLabel = t("presetEditor.actions.save");
    const saveButton = wrapper.findAll("button").find((btn) => btn.text().includes(saveLabel));
    expect(saveButton).toBeTruthy();
    await saveButton!.trigger("click");

    expect(emitted.length).toBe(1);
    const preset = emitted[0];

    expect(preset.audio.codec).toBe("aac");
    expect(preset.audio.bitrate).toBe(320);
    expect(preset.audio.loudnessProfile).toBe("ebuR128");
  });

  it("can switch from new preset wizard directly into the full parameter panel", async () => {
    const switched: FFmpegPreset[] = [];

    const wrapper = mount(ParameterWizard, {
      props: {
        initialPreset: null,
        onSwitchToPanel: (preset: FFmpegPreset) => switched.push(preset),
      },
      global: {
        plugins: [i18n],
      },
    });

    const switchButton = wrapper.find("[data-testid='preset-open-panel']");
    expect(switchButton).toBeTruthy();
    await switchButton.trigger("click");

    expect(switched.length).toBe(1);
    const preset = switched[0];
    // 新建预设时也应该生成一个有效的 id 与名称占位。
    expect(preset.id).toBeTypeOf("string");
    expect(preset.name.length).toBeGreaterThan(0);
  });

  it("creates a custom command preset when selected on the first step", async () => {
    const emitted: FFmpegPreset[] = [];

    const wrapper = mount(ParameterWizard, {
      props: {
        initialPreset: null,
        onSave: (preset: FFmpegPreset) => emitted.push(preset),
      },
      global: {
        plugins: [i18n],
      },
    });

    const customButton = wrapper.find("[data-testid='preset-kind-custom']");
    expect(customButton.exists()).toBe(true);
    await customButton.trigger("click");

    const nextLabel = t("common.next");
    const nextFromKind = wrapper.findAll("button").find((btn) => btn.text().includes(nextLabel));
    expect(nextFromKind).toBeTruthy();
    await nextFromKind!.trigger("click");

    const saveLabel = t("presetEditor.actions.save");
    const saveButton = wrapper.findAll("button").find((btn) => btn.text().includes(saveLabel));
    expect(saveButton).toBeTruthy();
    await saveButton!.trigger("click");

    expect(emitted.length).toBe(1);
    const preset = emitted[0];
    expect(preset.advancedEnabled).toBe(true);
    expect(preset.ffmpegTemplate?.includes("INPUT")).toBe(true);
    expect(preset.ffmpegTemplate?.includes("OUTPUT")).toBe(true);
  });
});
