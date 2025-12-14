// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import FormatSelect from "@/components/formats/FormatSelect.vue";
import type { FormatCatalogEntry } from "@/lib/formatCatalog";

describe("FormatSelect trigger label", () => {
  it("shows only the short label in the trigger (not the note/description)", () => {
    const entries: FormatCatalogEntry[] = [
      { value: "webm", label: "WebM (.webm)", kind: "video", keywords: ["webm"], note: "仅支持 VP8/VP9/AV1 视频 + Opus/Vorbis 音频" },
    ];

    const wrapper = mount(FormatSelect, {
      props: {
        modelValue: "webm",
        entries,
      },
      global: {
        stubs: {
          Select: { template: `<div data-testid="select"><slot /></div>` },
          SelectTrigger: { template: `<button data-testid="trigger"><slot /></button>` },
          SelectValue: { template: `<span data-testid="value"><slot /></span>` },
          SelectContent: { template: `<div data-testid="content"></div>` },
          SelectItem: { template: `<div />` },
          Separator: { template: `<div />` },
          Input: { template: `<input />` },
        },
      },
    });

    expect(wrapper.get("[data-testid='value']").text()).toBe("WebM (.webm)");
    expect(wrapper.text()).not.toContain("仅支持 VP8/VP9/AV1");
  });
});

