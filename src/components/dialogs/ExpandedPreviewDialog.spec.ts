// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ExpandedPreviewDialog from "@/components/dialogs/ExpandedPreviewDialog.vue";
import en from "@/locales/en";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
  },
});

describe("ExpandedPreviewDialog", () => {
  it("emits videoError and stops playback when metadata has zero dimensions", async () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-1",
          filename: "C:/videos/sample.mp4",
        } as any,
        previewUrl: "file:///C:/videos/sample.mp4",
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
      },
    });

    const videoEl: Partial<HTMLVideoElement> = {
      videoWidth: 0,
      videoHeight: 0,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };

    // 直接调用组件内部的事件处理函数，模拟 loadedmetadata 事件。
    // @ts-expect-error script setup 下方法通过实例暴露给测试
    await wrapper.vm.handleVideoLoadedMetadata({ target: videoEl } as Event);

    const errors = wrapper.emitted("videoError");
    expect(errors).toBeTruthy();
    expect(errors?.length).toBe(1);
    expect((videoEl.pause as any)).toHaveBeenCalled();
    expect((videoEl.load as any)).toHaveBeenCalled();
    expect((videoEl.removeAttribute as any)).toHaveBeenCalledWith("src");
  });

  it("does not emit videoError when metadata reports valid dimensions", async () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-2",
          filename: "C:/videos/ok.mp4",
        } as any,
        previewUrl: "file:///C:/videos/ok.mp4",
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
      },
    });

    const videoEl: Partial<HTMLVideoElement> = {
      videoWidth: 1920,
      videoHeight: 1080,
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };

    // @ts-expect-error script setup 下方法通过实例暴露给测试
    await wrapper.vm.handleVideoLoadedMetadata({ target: videoEl } as Event);

    const errors = wrapper.emitted("videoError");
    expect(errors).toBeFalsy();
  });
});
