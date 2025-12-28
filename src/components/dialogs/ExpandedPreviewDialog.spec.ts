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
  it("constrains dialog height and clips overflow", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-layout-1",
          filename: "C:/videos/sample.mp4",
          inputPath: "C:/videos/sample.mp4",
          outputPath: "C:/videos/out.mp4",
        } as any,
        previewSourceMode: "output",
        previewUrl: "file:///C:/videos/out.mp4",
        previewPath: "C:/videos/out.mp4",
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: '<div v-bind="$attrs"><slot /></div>' },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    const content = wrapper.get('[data-testid="expanded-preview-dialog"]');
    expect(content.classes()).toContain("overflow-y-auto");
    expect(content.classes()).toContain("overflow-x-hidden");
    expect(content.classes()).toContain("max-h-[calc(100vh-2rem)]");
  });

  it("uses an aspect-ratio surface in normal video mode", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-normal-layout-1",
          filename: "C:/videos/sample.mp4",
          inputPath: "C:/videos/sample.mp4",
          outputPath: "C:/videos/out.mp4",
        } as any,
        previewSourceMode: "output",
        previewUrl: "file:///C:/videos/out.mp4",
        previewPath: "C:/videos/out.mp4",
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: '<div v-bind="$attrs"><slot /></div>' },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    const surface = wrapper.get('[data-testid="expanded-preview-surface"]');
    expect(surface.classes()).toContain("max-h-[70vh]");
    expect(surface.classes()).toContain("aspect-video");
    expect(surface.classes()).toContain("overflow-y-hidden");
    expect(surface.classes()).not.toContain("h-[70vh]");
    expect(surface.classes()).not.toContain("overflow-y-auto");
  });

  it("does not clip fallback preview controls when native playback fails", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-fallback-layout-1",
          filename: "C:/videos/sample.mp4",
          inputPath: "C:/videos/sample.mp4",
          outputPath: "C:/videos/out.mp4",
        } as any,
        previewSourceMode: "output",
        previewUrl: "file:///C:/videos/out.mp4",
        previewPath: "C:/videos/out.mp4",
        isImage: false,
        error: "Native playback failed",
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: '<div v-bind="$attrs"><slot /></div>' },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    const surface = wrapper.get('[data-testid="expanded-preview-surface"]');
    expect(surface.classes()).toContain("h-[70vh]");
    expect(surface.classes()).toContain("overflow-y-auto");
    expect(surface.classes()).not.toContain("aspect-video");
    expect(surface.classes()).not.toContain("overflow-y-hidden");
  });

  it("keeps the aspect-ratio surface when the preview is an image (even if the image errors)", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-image-layout-1",
          filename: "C:/images/sample.png",
          inputPath: "C:/images/sample.png",
          outputPath: "C:/images/out.png",
          type: "image",
        } as any,
        previewSourceMode: "output",
        previewUrl: "file:///C:/images/out.png",
        previewPath: "C:/images/out.png",
        isImage: true,
        error: "Image decode failed",
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: '<div v-bind="$attrs"><slot /></div>' },
          DialogHeader: { template: "<div><slot /></div>" },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    const surface = wrapper.get('[data-testid="expanded-preview-surface"]');
    expect(surface.classes()).toContain("aspect-video");
    expect(surface.classes()).toContain("overflow-y-hidden");
    expect(surface.classes()).not.toContain("overflow-y-auto");
  });

  it("uses the resolved previewPath as the title when available", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-title-1",
          filename: "C:/videos/input.mp4",
          inputPath: "C:/videos/input.mp4",
          outputPath: "C:/videos/output.mp4",
        } as any,
        previewSourceMode: "output",
        previewUrl: "file:///C:/videos/output.mp4",
        previewPath: "C:/videos/output.mp4",
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

    expect(wrapper.text()).toContain("C:/videos/output.mp4");
  });

  it("labels a shared input/output path using the selected source mode", () => {
    const shared = "C:/videos/shared.mp4";
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-shared-1",
          filename: shared,
          inputPath: shared,
          outputPath: shared,
        } as any,
        previewSourceMode: "input",
        previewUrl: `file:///${shared}`,
        previewPath: shared,
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

    expect(wrapper.get("[data-testid='expanded-preview-source-badge']").text()).toBe("Input");
  });

  it("constrains long titles using truncation instead of growing the layout", () => {
    const longName = `C:/videos/${"a".repeat(420)}.mp4`;
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-long-title-1",
          filename: longName,
          inputPath: longName,
          outputPath: "C:/videos/out.mp4",
        } as any,
        previewSourceMode: "input",
        previewUrl: `file:///${longName}`,
        previewPath: longName,
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

    const title = wrapper.get('[data-testid="expanded-preview-title-text"]');
    expect(title.attributes("title")).toBe(longName);
    expect(title.classes()).toContain("truncate");
    expect(title.classes()).toContain("block");
  });

  it("prevents header content from forcing a minimum width", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-header-minw-1",
          filename: `C:/videos/${"x".repeat(512)}.mp4`,
          inputPath: "C:/videos/in.mp4",
          outputPath: "C:/videos/out.mp4",
        } as any,
        previewSourceMode: "input",
        previewUrl: "file:///C:/videos/in.mp4",
        previewPath: `C:/videos/${"x".repeat(512)}.mp4`,
        isImage: false,
        error: null,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: '<div v-bind="$attrs"><slot /></div>' },
          DialogHeader: { template: '<div v-bind="$attrs"><slot /></div>' },
          DialogTitle: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<div><slot /></div>" },
        },
      },
    });

    expect(wrapper.get('[data-testid="expanded-preview-dialog"]').classes()).toContain("min-w-0");
    expect(wrapper.get('[data-testid="expanded-preview-title-text"]').classes()).toContain("min-w-0");
  });

  it("disables the output toggle for in-flight jobs without a temp output path", () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-disable-output-1",
          filename: "C:/videos/inflight.mp4",
          type: "video",
          status: "processing",
          inputPath: "C:/videos/inflight.mp4",
          outputPath: "C:/videos/inflight.out.mkv",
        } as any,
        previewSourceMode: "input",
        previewUrl: "file:///C:/videos/inflight.mp4",
        previewPath: "C:/videos/inflight.mp4",
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

    const outputToggle = wrapper.get("[data-testid='expanded-preview-source-output']");
    expect(outputToggle.attributes("data-disabled")).toBeDefined();
  });

  it("emits videoError when metadata has zero dimensions", async () => {
    const wrapper = mount(ExpandedPreviewDialog, {
      props: {
        open: true,
        job: {
          id: "job-1",
          filename: "C:/videos/sample.mp4",
        } as any,
        previewSourceMode: "output",
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
        previewSourceMode: "output",
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
