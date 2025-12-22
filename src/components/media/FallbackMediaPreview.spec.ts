// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import en from "@/locales/en";
import FallbackMediaPreview from "@/components/media/FallbackMediaPreview.vue";
import { Slider } from "@/components/ui/slider";

const extractFallbackPreviewFrameMock = vi.fn();

// Reka UI components rely on ResizeObserver for layout measurement.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    buildPreviewUrl: (path: string) => path,
    loadPreviewDataUrl: vi.fn(async (path: string) => `data:image/jpeg;base64,${path}`),
    extractFallbackPreviewFrame: (...args: any[]) => extractFallbackPreviewFrameMock(...args),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

describe("FallbackMediaPreview", () => {
  beforeEach(() => {
    extractFallbackPreviewFrameMock.mockReset();
  });

  it("hides the scrubbing hint by default, but can opt-in via showHint", async () => {
    extractFallbackPreviewFrameMock.mockResolvedValue("/tmp/frame.jpg");

    const wrapper = mount(FallbackMediaPreview, {
      global: {
        plugins: [i18n],
      },
      props: {
        nativeUrl: "file:///C:/videos/sample.mp4",
        sourcePath: "C:/videos/sample.mp4",
        durationSeconds: 10,
      },
    });

    await wrapper.get("video").trigger("error");
    await nextTick();

    expect(wrapper.text()).not.toContain(
      "While dragging, the app prefers faster low-quality frames; when you release, it loads a higher-quality frame.",
    );

    await wrapper.setProps({ showHint: true });
    await nextTick();

    expect(wrapper.text()).toContain(
      "While dragging, the app prefers faster low-quality frames; when you release, it loads a higher-quality frame.",
    );

    wrapper.unmount();
  });

  it("switches to fallback frame mode and requests a high-quality frame after native playback error", async () => {
    extractFallbackPreviewFrameMock.mockResolvedValueOnce("/tmp/frame-high.jpg");

    const wrapper = mount(FallbackMediaPreview, {
      global: {
        plugins: [i18n],
      },
      props: {
        nativeUrl: "file:///C:/videos/sample.mp4",
        sourcePath: "C:/videos/sample.mp4",
        durationSeconds: 10,
        proxyQualityPreset: 720,
      },
    });

    await wrapper.get("video").trigger("error");
    await nextTick();

    expect(extractFallbackPreviewFrameMock).toHaveBeenCalledWith({
      sourcePath: "C:/videos/sample.mp4",
      positionPercent: 50,
      durationSeconds: 10,
      quality: "high",
    });

    wrapper.unmount();
  });

  it("debounces low-quality frame requests while scrubbing and requests high quality on commit", async () => {
    vi.useFakeTimers();

    extractFallbackPreviewFrameMock.mockResolvedValue("/tmp/frame.jpg");

    const wrapper = mount(FallbackMediaPreview, {
      global: {
        plugins: [i18n],
      },
      props: {
        nativeUrl: "file:///C:/videos/sample.mp4",
        sourcePath: "C:/videos/sample.mp4",
        durationSeconds: 10,
      },
    });

    await wrapper.get("video").trigger("error");
    await nextTick();
    extractFallbackPreviewFrameMock.mockClear();

    // Simulate dragging slider to 80%.
    const slider = wrapper.getComponent(Slider);
    slider.vm.$emit("update:modelValue", [80]);

    vi.advanceTimersByTime(121);
    await nextTick();

    expect(extractFallbackPreviewFrameMock).toHaveBeenCalledWith({
      sourcePath: "C:/videos/sample.mp4",
      positionPercent: 80,
      durationSeconds: 10,
      quality: "low",
    });

    extractFallbackPreviewFrameMock.mockClear();

    // Commit should trigger a high-quality frame immediately.
    slider.vm.$emit("valueCommit", [80]);
    await nextTick();

    expect(extractFallbackPreviewFrameMock).toHaveBeenCalledWith({
      sourcePath: "C:/videos/sample.mp4",
      positionPercent: 80,
      durationSeconds: 10,
      quality: "high",
    });

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("clamps scrub percent to [0, 100] before requesting frames", async () => {
    vi.useFakeTimers();

    extractFallbackPreviewFrameMock.mockResolvedValue("/tmp/frame.jpg");

    const wrapper = mount(FallbackMediaPreview, {
      global: {
        plugins: [i18n],
      },
      props: {
        nativeUrl: "file:///C:/videos/sample.mp4",
        sourcePath: "C:/videos/sample.mp4",
        durationSeconds: 10,
      },
    });

    await wrapper.get("video").trigger("error");
    await nextTick();
    extractFallbackPreviewFrameMock.mockClear();

    const slider = wrapper.getComponent(Slider);
    slider.vm.$emit("update:modelValue", [101]);

    vi.advanceTimersByTime(121);
    await nextTick();

    expect(extractFallbackPreviewFrameMock).toHaveBeenCalledWith({
      sourcePath: "C:/videos/sample.mp4",
      positionPercent: 100,
      durationSeconds: 10,
      quality: "low",
    });

    wrapper.unmount();
    vi.useRealTimers();
  });
});
