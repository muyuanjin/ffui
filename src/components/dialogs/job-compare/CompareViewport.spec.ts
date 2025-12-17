// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import CompareViewport from "./CompareViewport.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

describe("CompareViewport", () => {
  it("shows corner side labels in side-by-side mode", () => {
    const wrapper = mount(CompareViewport, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        mode: "side-by-side",
        loadingSources: false,
        sourcesError: null,
        usingFrameCompare: true,
        inputVideoUrl: null,
        outputVideoUrl: null,
        inputFrameUrl: "C:/previews/input.jpg",
        inputFrameLoading: false,
        inputFrameError: null,
        inputFrameQuality: "high",
        outputFrameUrl: "C:/previews/output.jpg",
        outputFrameLoading: false,
        outputFrameError: null,
        outputFrameQuality: "high",
      },
    });

    expect(wrapper.find('[data-testid="job-compare-corner-side-labels"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="job-compare-corner-side-label-input"]').text()).toBe("Input");
    expect(wrapper.get('[data-testid="job-compare-corner-side-label-output"]').text()).toBe("Output");
  });

  it("shows corner side labels in wipe mode", () => {
    const wrapper = mount(CompareViewport, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        mode: "wipe",
        loadingSources: false,
        sourcesError: null,
        usingFrameCompare: true,
        inputVideoUrl: null,
        outputVideoUrl: null,
        inputFrameUrl: "C:/previews/input.jpg",
        inputFrameLoading: false,
        inputFrameError: null,
        inputFrameQuality: "high",
        outputFrameUrl: "C:/previews/output.jpg",
        outputFrameLoading: false,
        outputFrameError: null,
        outputFrameQuality: "high",
      },
    });

    expect(wrapper.find('[data-testid="job-compare-corner-side-labels"]').exists()).toBe(true);
  });

  it("does not show corner side labels while loading or in error state", () => {
    const loading = mount(CompareViewport, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        mode: "wipe",
        loadingSources: true,
        sourcesError: null,
        usingFrameCompare: true,
        inputVideoUrl: null,
        outputVideoUrl: null,
        inputFrameUrl: null,
        inputFrameLoading: false,
        inputFrameError: null,
        inputFrameQuality: "high",
        outputFrameUrl: null,
        outputFrameLoading: false,
        outputFrameError: null,
        outputFrameQuality: "high",
      },
    });
    expect(loading.find('[data-testid="job-compare-corner-side-labels"]').exists()).toBe(false);

    const error = mount(CompareViewport, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        mode: "wipe",
        loadingSources: false,
        sourcesError: "Boom",
        usingFrameCompare: true,
        inputVideoUrl: null,
        outputVideoUrl: null,
        inputFrameUrl: null,
        inputFrameLoading: false,
        inputFrameError: null,
        inputFrameQuality: "high",
        outputFrameUrl: null,
        outputFrameLoading: false,
        outputFrameError: null,
        outputFrameQuality: "high",
      },
    });
    expect(error.find('[data-testid="job-compare-corner-side-labels"]').exists()).toBe(false);
  });
});
