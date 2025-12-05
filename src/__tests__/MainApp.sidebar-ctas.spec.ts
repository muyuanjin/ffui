// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import MainApp from "@/MainApp.vue";
import zhCN from "@/locales/zh-CN";
import en from "@/locales/en";

const makeWrapper = (locale: "zh-CN" | "en") => {
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: {
      "zh-CN": zhCN as any,
      en: en as any,
    },
  });

  return mount(MainApp, {
    global: {
      plugins: [i18n],
    },
  });
};

describe("MainApp sidebar primary actions", () => {
  it("uses updated zh-CN labels for Add transcode / Add compression actions", () => {
    const wrapper = makeWrapper("zh-CN");
    const text = wrapper.text();

    expect(text).toContain("添加转码任务");
    expect(text).toContain("添加压缩任务");
  });

  it("uses updated EN labels and distinct button styles for the two CTAs", () => {
    const wrapper = makeWrapper("en");

    const buttons = wrapper.findAll("button");
    const addTranscodeButton = buttons.find((btn) =>
      btn.text().includes("Add transcode job"),
    );
    const addCompressionButton = buttons.find((btn) =>
      btn.text().includes("Add compression task"),
    );

    expect(addTranscodeButton, "Add transcode job button should exist").toBeTruthy();
    expect(
      addCompressionButton,
      "Add compression task button should exist",
    ).toBeTruthy();

    const addTranscodeClass = addTranscodeButton?.attributes("class") ?? "";
    const addCompressionClass = addCompressionButton?.attributes("class") ?? "";

    expect(addTranscodeClass.length).toBeGreaterThan(0);
    expect(addCompressionClass.length).toBeGreaterThan(0);
    // Distinct shadcn-vue variants should result in different class strings.
    expect(addTranscodeClass).not.toEqual(addCompressionClass);
  });

  it("shows a New Preset CTA on the presets tab and opens the preset wizard when clicked", async () => {
    const wrapper = makeWrapper("zh-CN");
    const vm: any = wrapper.vm;

    // Switch to presets tab so the header CTA becomes visible.
    vm.activeTab = "presets";
    await nextTick();

    const buttons = wrapper.findAll("button");
    const newPresetButton = buttons.find((btn) =>
      btn.text().includes("新建预设"),
    );

    expect(
      newPresetButton,
      "New Preset button should be visible on the presets tab",
    ).toBeTruthy();

    expect(vm.dialogManager?.wizardOpen?.value).toBe(false);
    await newPresetButton!.trigger("click");
    await nextTick();
    expect(vm.dialogManager?.wizardOpen?.value).toBe(true);
  });
});
