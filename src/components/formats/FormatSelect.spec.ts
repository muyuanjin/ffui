// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import FormatSelect from "./FormatSelect.vue";
import PresetContainerTab from "@/components/preset-editor/PresetContainerTab.vue";
import { FORMAT_CATALOG, filterFormatCatalog } from "@/lib/formatCatalog";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const makeI18n = () => createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zhCN } });
afterEach(() => {
  document.body.innerHTML = "";
});

describe("media format selection", () => {
  it.each(["mp3", "aac", "m4a", "wav", "png", "webp"])(
    "selects %s without a media-category restriction",
    async (format) => {
      const wrapper = mount(FormatSelect, {
        props: { modelValue: "mp4", entries: FORMAT_CATALOG },
        attachTo: document.body,
        global: { plugins: [makeI18n()] },
      });
      await wrapper.get('[role="combobox"]').trigger("keydown", { key: "ArrowDown" });
      await flushPromises();
      const entry = FORMAT_CATALOG.find((candidate) => candidate.value === format)!;
      const option = [...document.querySelectorAll('[role="option"]')].find((element) =>
        element.textContent?.includes(entry.label),
      );
      expect(option).toBeDefined();
      expect(option!.getAttribute("data-disabled")).toBeNull();
      await new DOMWrapper(option!).trigger("keydown", { key: "Enter" });
      expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]).toEqual([format]);
      wrapper.unmount();
    },
  );

  it("keeps audio/image formats available in the preset container editor", async () => {
    const wrapper = mount(PresetContainerTab, {
      props: { container: { format: "mp3" } },
      global: { plugins: [makeI18n()] },
    });
    const selector = wrapper.getComponent(FormatSelect);
    expect(selector.props("entries")).toContainEqual(expect.objectContaining({ value: "mp3" }));
    selector.vm.$emit("update:modelValue", "png");
    expect(wrapper.props("container").format).toBe("png");
    wrapper.unmount();
  });

  it("finds the M4A container when searching for the ALAC codec", () => {
    expect(FORMAT_CATALOG.some((entry) => entry.value === "alac")).toBe(false);
    expect(filterFormatCatalog(FORMAT_CATALOG, "alac").map((entry) => entry.value)).toEqual(["m4a"]);
  });

  it("updates the automatic choice immediately after locale changes", async () => {
    const i18n = makeI18n();
    const wrapper = mount(FormatSelect, {
      props: {
        modelValue: "auto",
        entries: FORMAT_CATALOG,
        autoValue: "auto",
        autoLabel: i18n.global.t("outputPolicy.container.default"),
      },
      global: { plugins: [i18n] },
    });
    i18n.global.locale.value = "zh-CN";
    await wrapper.setProps({ autoLabel: i18n.global.t("outputPolicy.container.default") });
    expect(wrapper.get('[role="combobox"]').text()).toContain("默认（走预设/模板）");
    wrapper.unmount();
  });
});
