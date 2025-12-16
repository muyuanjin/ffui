// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

// reka-ui Slider depends on ResizeObserver; provide a minimal polyfill for jsdom.
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/lib/backend", () => {
  return {
    buildPreviewUrl: (path: string) => path,
    extractFallbackPreviewFrame: vi.fn(async () => "C:/tmp/frame.jpg"),
    hasTauri: () => false,
    loadPreviewDataUrl: vi.fn(async () => "data:image/jpeg;base64,TEST"),
  };
});

import FallbackMediaPreview from "@/components/media/FallbackMediaPreview.vue";
import en from "@/locales/en";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

describe("FallbackMediaPreview fallback controls", () => {
  it("keeps percent padded and actions right-aligned in fallback mode", async () => {
    const wrapper = mount(FallbackMediaPreview, {
      props: {
        nativeUrl: "asset://sample.mp4",
        sourcePath: "C:/videos/sample.mp4",
        forceFallback: true,
        showCopyPathAction: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    await nextTick();

    const fallback = wrapper.get('[data-testid="fallback-media-preview"]');
    expect(fallback.classes()).toContain("p-2");

    const percent = wrapper.get("span.tabular-nums");
    expect(percent.text()).toBe("50%");

    const actions = wrapper.get("div.justify-end");
    expect(actions.text()).toContain("Open in system player");
    expect(actions.text()).toContain("Copy path");

    wrapper.unmount();
  });
});

