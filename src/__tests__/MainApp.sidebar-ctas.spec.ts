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

  const wrapper = mount(MainApp, {
    global: {
      plugins: [i18n],
      provide: {
        i18n,
      },
    },
  });

  // Return both wrapper and the i18n instance so tests do not rely on
  // instance-level $i18n, which is more brittle and harder to type.
  return { wrapper, i18n };
};

describe("MainApp sidebar primary actions", () => {
  it("uses updated zh-CN labels for Add transcode / Add compression actions", () => {
    const { wrapper } = makeWrapper("zh-CN");

    const addFilesButton = wrapper.find('[data-testid="ffui-action-add-job-files"]');
    const addCompressionButton = wrapper.find('[data-testid="ffui-action-smart-scan"]');

    expect(addFilesButton.exists()).toBe(true);
    expect(addCompressionButton.exists()).toBe(true);
    expect(addFilesButton.text()).toContain("添加文件");
    expect(addCompressionButton.text()).toContain("添加压缩任务");
  });

  it("uses updated EN labels and distinct button styles for the two CTAs", () => {
    const { wrapper } = makeWrapper("en");

    const addFilesButton = wrapper.find('[data-testid="ffui-action-add-job-files"]');
    const addCompressionButton = wrapper.find('[data-testid="ffui-action-smart-scan"]');

    expect(addFilesButton.exists(), "Add files button should exist").toBe(true);
    expect(addCompressionButton.exists(), "Add compression task button should exist").toBe(true);
    expect(addFilesButton.text()).toContain("Add files");
    expect(addCompressionButton.text()).toContain("Add compression task");

    const addFilesClass = addFilesButton.attributes("class") ?? "";
    const addCompressionClass = addCompressionButton.attributes("class") ?? "";

    expect(addFilesClass.length).toBeGreaterThan(0);
    expect(addCompressionClass.length).toBeGreaterThan(0);
    // Distinct shadcn-vue variants should result in different class strings.
    expect(addFilesClass).not.toEqual(addCompressionClass);
  });

  it("shows a New Preset CTA on the presets tab and opens the preset wizard when clicked", async () => {
    const { wrapper } = makeWrapper("zh-CN");
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

  it("updates sidebar CTA labels when locale changes at runtime without duplicating buttons", async () => {
    const { wrapper, i18n } = makeWrapper("zh-CN");

    const addFilesButton = () => wrapper.find('[data-testid="ffui-action-add-job-files"]');
    const addCompressionButton = () => wrapper.find('[data-testid="ffui-action-smart-scan"]');

    expect(addFilesButton().exists()).toBe(true);
    expect(addCompressionButton().exists()).toBe(true);
    expect(addFilesButton().text()).toContain("添加文件");
    expect(addCompressionButton().text()).toContain("添加压缩任务");

    // Switch locale via the i18n instance used to mount the app.
    (i18n.global.locale as any).value = "en";
    await nextTick();

    expect(addFilesButton().exists()).toBe(true);
    expect(addCompressionButton().exists()).toBe(true);
    expect(addFilesButton().text()).toContain("Add files");
    expect(addCompressionButton().text()).toContain("Add compression task");
  });
});
