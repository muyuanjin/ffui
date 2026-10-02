// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
      global: { plugins: [i18n], stubs: { PopoverContent: { template: "<div><slot /></div>" } } },
    });
    expect(wrapper.get('[data-testid="ffui-queue-default-preset-trigger"]').text()).toBe("Default preset");
    expect(wrapper.get('[data-testid="queue-preset-summary-badge"]').text()).toBe("H264");
    wrapper.findAllComponents(Select)[0].vm.$emit("update:modelValue", "byMedia");
    expect(wrapper.emitted("update:selection")?.[0]).toEqual([{ mode: "byMedia" }]);
    await wrapper.setProps({ selection: { mode: "byMedia", video: "audio", audio: "deleted" } });
    expect(wrapper.get('[data-testid="queue-preset-video-trigger"]').text()).toBe("MP3 extraction");
    expect(wrapper.get('[data-testid="queue-preset-audio-trigger"]').text()).toContain("Missing preset: deleted");
    expect(wrapper.get('[data-testid="queue-preset-image-trigger"]').text()).toContain("Follow unified: H264");
    expect(wrapper.findAll('[data-testid="queue-preset-summary-badge"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="queue-preset-summary-badge"]')[2].text()).toBe("H264");
    wrapper.findAllComponents(Select)[1].vm.$emit("update:modelValue", "audio");
    expect(wrapper.emitted("update:unifiedPresetId")?.[0]).toEqual(["audio"]);
    expect(wrapper.emitted("update:selection")).toHaveLength(1);
    i18n.global.locale.value = "zh-CN";
    await nextTick();
    expect(wrapper.get('[data-testid="queue-preset-selection-mode"]').text()).toContain("按输入类型");
    expect(wrapper.get('[data-testid="queue-preset-audio-trigger"]').text()).toContain("预设已缺失：deleted");
    expect(wrapper.get('[data-testid="queue-preset-image-trigger"]').text()).toContain("跟随统一预设：H264");
    expect(wrapper.get('[data-testid="ffui-queue-default-preset-trigger"]').text()).toBe("默认预设");
    expect(wrapper.findAll('[data-testid="queue-preset-summary-badge"]')[2].attributes("title")).toContain(
      "跟随统一预设",
    );
    wrapper.findAllComponents(Select)[4].vm.$emit("update:modelValue", "audio");
    expect(wrapper.emitted("update:selection")?.slice(-1)[0]).toEqual([
      { mode: "byMedia", video: "audio", audio: "deleted", image: "audio" },
    ]);
    await wrapper.setProps({ unifiedPresetId: "deleted" });
    expect(wrapper.get('[data-testid="queue-unified-preset-trigger"]').text()).toContain("预设已缺失：deleted");
    expect(wrapper.findAll('[data-testid="queue-preset-summary-badge"]')[2].text()).toContain("预设已缺失：deleted");
    wrapper.unmount();
  });

  it("keeps routing controls out of the closed toolbar and opens them from one button", async () => {
    const i18n = createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zhCN } });
    const wrapper = mount(QueuePresetSelector, {
      attachTo: document.body,
      props: {
        presets: [{ id: "audio", name: "Audio extraction with a very long preset name" }] as FFmpegPreset[],
        unifiedPresetId: "audio",
        selection: { mode: "unified" },
      },
      global: { plugins: [i18n] },
    });
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(document.querySelector('[data-testid="queue-preset-selection-mode"]')).toBeNull();
    expect(wrapper.get('[data-testid="queue-preset-summary-badge"]').attributes("title")).toContain("very long");
    await wrapper.get("button").trigger("click");
    await nextTick();
    expect(document.querySelector('[data-testid="queue-preset-settings"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="queue-preset-selection-mode"]')?.textContent).toContain(
      "Unified preset",
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-testid="queue-preset-settings"]')).toBeNull());
    await wrapper.get("button").trigger("click");
    await nextTick();
    expect(document.querySelector('[data-testid="queue-preset-settings"]')).not.toBeNull();
    await wrapper.get("button").trigger("click");
    await vi.waitFor(() => expect(document.querySelector('[data-testid="queue-preset-settings"]')).toBeNull());
    expect(wrapper.emitted("update:selection")).toBeUndefined();
    expect(wrapper.emitted("update:unifiedPresetId")).toBeUndefined();
    await wrapper.setProps({ selection: { mode: "byMedia", audio: "audio" } });
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="queue-preset-summary-badge"]')).toHaveLength(3);
    expect(document.querySelector('[data-testid="queue-preset-selection-mode"]')).toBeNull();
    wrapper.unmount();
  });
});
