// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import QueuePresetSelector from "./QueuePresetSelector.vue";
import { Select } from "@/components/ui/select";
import type { FFmpegPreset } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

describe("queue default preset selection", () => {
  it("exposes unified and input-specific selection, explicit fallback and missing references", async () => {
    const i18n = createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zhCN } });
    const wrapper = mount(QueuePresetSelector, {
      props: {
        presets: [
          { id: "audio", name: "MP3 extraction" },
          { id: "video", name: "H264" },
        ] as FFmpegPreset[],
        unifiedPresetId: "video",
        selection: { mode: "unified" },
      },
      global: { plugins: [i18n] },
    });
    expect(wrapper.get('[data-testid="ffui-queue-default-preset-trigger"]').text()).toBe("H264");
    wrapper.findAllComponents(Select)[0].vm.$emit("update:modelValue", "byMedia");
    expect(wrapper.emitted("update:selection")?.[0]).toEqual([{ mode: "byMedia" }]);
    await wrapper.setProps({ selection: { mode: "byMedia", video: "audio", audio: "deleted" } });
    expect(wrapper.get('[data-testid="queue-preset-video-trigger"]').text()).toBe("MP3 extraction");
    expect(wrapper.get('[data-testid="queue-preset-audio-trigger"]').text()).toContain("Missing preset: deleted");
    expect(wrapper.get('[data-testid="queue-preset-image-trigger"]').text()).toContain("Follow unified: H264");
    i18n.global.locale.value = "zh-CN";
    await nextTick();
    expect(wrapper.get('[data-testid="queue-preset-selection-mode"]').text()).toContain("按输入类型");
    expect(wrapper.get('[data-testid="queue-preset-audio-trigger"]').text()).toContain("预设已缺失：deleted");
    expect(wrapper.get('[data-testid="queue-preset-image-trigger"]').text()).toContain("跟随统一预设：H264");
    wrapper.findAllComponents(Select)[3].vm.$emit("update:modelValue", "audio");
    expect(wrapper.emitted("update:selection")?.slice(-1)[0]).toEqual([
      { mode: "byMedia", video: "audio", audio: "deleted", image: "audio" },
    ]);
    wrapper.unmount();
  });
});
