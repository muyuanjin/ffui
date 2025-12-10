// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { resolvePresetDescription } from "./presetLocalization";

describe("resolvePresetDescription", () => {
  it("优先返回匹配当前语言的描述，并在缺失时回退到基础语言", () => {
    const preset = {
      description: "中文默认描述",
      descriptionI18n: {
        en: "English description",
        "en-US": "English US description",
        "zh-CN": "中文默认描述",
      },
    } as any;

    expect(resolvePresetDescription(preset, "en")).toBe("English description");
    expect(resolvePresetDescription(preset, "en-US")).toBe("English US description");
    expect(resolvePresetDescription(preset, "en-GB")).toBe("English description");
  });

  it("缺少匹配项时回退到原始 description", () => {
    const preset = {
      description: "中文默认描述",
      descriptionI18n: {
        fr: "Description française",
      },
    } as any;

    expect(resolvePresetDescription(preset, "en")).toBe("中文默认描述");
  });
});
