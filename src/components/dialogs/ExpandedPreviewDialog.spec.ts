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
  it("emits videoError when metadata has zero dimensions", async () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-1",
          filename: "C:/videos/sample.mp4",
        } as any,
        previewSourceMode: "auto",
        previewUrl: "file:///C:/videos/sample.mp4",
        previewPath: "C:/videos/sample.mp4",
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: "<div><slot /></div>" },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    const video = wrapper.get('[data-testid="task-detail-expanded-video"]');
    const videoEl = video.element as HTMLVideoElement;

    Object.defineProperty(videoEl, "videoWidth", { value: 0, configurable: true });
    Object.defineProperty(videoEl, "videoHeight", { value: 0, configurable: true });

    const pauseSpy = vi.spyOn(videoEl, "pause").mockImplementation(() => {});
    const loadSpy = vi.spyOn(videoEl, "load").mockImplementation(() => {});
    const removeSpy = vi.spyOn(videoEl, "removeAttribute");

    await video.trigger("loadedmetadata");

    const errors = wrapper.emitted("videoError");
    expect(errors).toBeTruthy();
    expect(errors?.length).toBe(1);
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("src");
  });

  it("does not emit videoError when metadata reports valid dimensions", async () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-2",
          filename: "C:/videos/ok.mp4",
        } as any,
        previewSourceMode: "auto",
        previewUrl: "file:///C:/videos/ok.mp4",
        previewPath: "C:/videos/ok.mp4",
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: "<div><slot /></div>" },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    const video = wrapper.get('[data-testid="task-detail-expanded-video"]');
    const videoEl = video.element as HTMLVideoElement;

    Object.defineProperty(videoEl, "videoWidth", { value: 1920, configurable: true });
    Object.defineProperty(videoEl, "videoHeight", { value: 1080, configurable: true });

    await video.trigger("loadedmetadata");

    const errors = wrapper.emitted("videoError");
    expect(errors).toBeFalsy();
  });
});
