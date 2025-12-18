// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

// MediaPanel uses reka-ui (ScrollArea, Slider), which depends on ResizeObserver.
// Provide a minimal polyfill for jsdom to avoid mount-time errors.
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => false,
  };
});

import MediaPanel from "@/components/panels/MediaPanel.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MediaPanel fallback preview layout", () => {
  it("shows the non-overlay fallback UI after native video error", async () => {
    const wrapper = mount(MediaPanel, {
      props: {
        inspecting: false,
        error: null,
        inspectedPath: "C:/videos/sample.mp4",
        previewUrl: "asset://sample.mp4",
        isImage: false,
        analysis: {
          summary: {
            durationSeconds: 60,
          },
          format: {
            durationSeconds: 60,
          },
          streams: [],
          file: {
            path: "C:/videos/sample.mp4",
          },
          raw: {},
        },
        rawJson: "{}",
      },
      global: {
        plugins: [i18n],
      },
    });

    const video = wrapper.find('[data-testid="media-preview-video"]');
    expect(video.exists()).toBe(true);

    await video.trigger("error");
    await nextTick();

    expect(wrapper.find('[data-testid="fallback-media-preview"]').exists()).toBe(true);

    wrapper.unmount();
  });
});
