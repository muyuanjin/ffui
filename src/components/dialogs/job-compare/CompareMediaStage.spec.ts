// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import CompareMediaStage from "./CompareMediaStage.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

describe("CompareMediaStage", () => {
  it("disables native drag on images and clips via outer wipe layers (not transformed media)", () => {
    const wrapper = mount(CompareMediaStage, {
      global: { plugins: [i18n] },
      props: {
        mode: "wipe",
        usingFrameCompare: true,
        inputVideoUrl: null,
        outputVideoUrl: null,
        inputFrameUrl: "C:/previews/input.jpg",
        inputFrameLoading: false,
        inputFrameError: null,
        inputFrameQuality: "low",
        outputFrameUrl: "C:/previews/output.jpg",
        outputFrameLoading: false,
        outputFrameError: null,
        outputFrameQuality: "high",
        transformStyle: { transform: "translate(10px, 5px) scale(2)", transformOrigin: "0 0" },
        wipePercent: 50,
        blinkShowInput: false,
      },
    });

    const inputLayer = wrapper.get('[data-testid="job-compare-wipe-layer-input"]');
    const outputLayer = wrapper.get('[data-testid="job-compare-wipe-layer-output"]');
    expect(inputLayer.attributes("style")).toContain("clip-path");
    expect(outputLayer.attributes("style")).toContain("clip-path");

    const imgs = wrapper.findAll("img");
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(img.attributes("draggable")).toBe("false");
      expect(img.attributes("style") ?? "").not.toContain("clip-path");
    }
  });
});

