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

    // Recipe 会把 step 设置为 2，这里点击一次 Next 进入第 3 步，之后即可保存。
    const nextButton = wrapper
      .findAll("button")
      .find((btn) => btn.text().includes("common.next"));
    expect(nextButton).toBeTruthy();
    await nextButton!.trigger("click");

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
});
