// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ParameterWizard from "@/components/ParameterWizard.vue";
import type { FFmpegPreset } from "@/types";

// reka-ui 的下拉组件依赖 ResizeObserver，这里在测试环境中提供一个最小 mock。
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

    // Step 1: choose the fast NVENC recipe to switch encoder to hevc_nvenc.
    const recipeButtons = wrapper.findAll("button");
    const fastNvencButton = recipeButtons.find((btn) =>
      btn.text().includes("presetEditor.recipes.fastTranscode"),
    );
    expect(fastNvencButton).toBeTruthy();
    await fastNvencButton!.trigger("click");

    // Recipe 会把 step 设置为 2，这里依次点击 Next 直到最后一步再保存。
    for (let i = 0; i < 3; i += 1) {
      const nextButton = wrapper
        .findAll("button")
        .find((btn) => btn.text().includes("common.next"));
      expect(nextButton).toBeTruthy();
      await nextButton!.trigger("click");
    }

    // Final step: click the save button which triggers handleSave.
    const saveButton = wrapper
      .findAll("button")
      .find((btn) => btn.text().includes("presetEditor.actions.save"));
    expect(saveButton).toBeTruthy();
    await saveButton!.trigger("click");

    expect(emitted.length).toBe(1);
    const preset = emitted[0];

    expect(preset.video.encoder).toBe("hevc_nvenc");
    // 关键断言：保存到后端的 NVENC 预设里不应该再包含 x264 的 tune film。
    expect("tune" in preset.video).toBe(false);
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
});
