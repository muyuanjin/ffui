// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import MediaPanel from "./MediaPanel.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en },
});

const baseProps = {
  inspecting: false,
  error: null,
  inspectedPath: "/tmp/video.mp4",
  previewUrl: null,
  isImage: false,
  analysis: {
    file: {
      path: "/tmp/video.mp4",
      sizeBytes: 1024,
      createdMs: 1,
      modifiedMs: 2,
      accessedMs: 3,
    },
    summary: {
      durationSeconds: 1,
      width: 100,
      height: 100,
      frameRate: 24,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    format: {
      formatName: "mp4",
    },
    streams: [],
  } as any,
  rawJson: '{"format":{"duration":"60"},"streams":[]}',
};

describe("MediaPanel raw JSON actions", () => {
  let originalClipboard: any;

  beforeEach(() => {
    originalClipboard = (globalThis as any).navigator?.clipboard;
    (globalThis as any).navigator = {
      ...(globalThis as any).navigator,
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  afterEach(() => {
    (globalThis as any).navigator.clipboard = originalClipboard;
  });

  it("copies raw JSON when clicking the copy button", async () => {
    const wrapper = mount(MediaPanel, {
      props: baseProps,
      global: { plugins: [i18n] },
    });

    const button = wrapper.get("[data-testid='copy-raw-json-btn']");
    await button.trigger("click");

    const writeText = (navigator as any).clipboard.writeText as ReturnType<
      typeof vi.fn
    >;
    expect(writeText).toHaveBeenCalledWith(baseProps.rawJson);
  });

  it("renders highlighted JSON with scrollable large area", () => {
    const wrapper = mount(MediaPanel, {
      props: baseProps,
      global: { plugins: [i18n] },
    });

    const viewer = wrapper.get("[data-testid='raw-json-viewer']");
    const pre = viewer.get("pre");

    // 具备用于滚动的大面积容器样式
    expect(viewer.classes()).toContain("overflow-auto");
    expect(viewer.classes().some((cls) => cls.startsWith("max-h"))).toBe(true);

    // JSON 已经过基本语法高亮（key / string）
    const innerHtml = (pre.element as HTMLElement).innerHTML;
    expect(innerHtml).toContain("text-sky-400"); // key 高亮
    expect(innerHtml).toContain("text-emerald-200"); // string 高亮
  });
});

describe("MediaPanel empty state interactions", () => {
  const emptyProps = {
    inspecting: false,
    error: null,
    inspectedPath: null,
    previewUrl: null,
    isImage: false,
    analysis: null,
    rawJson: null,
  };

  it("emits inspectRequested when clicking the empty state", async () => {
    const wrapper = mount(MediaPanel, {
      props: emptyProps,
      global: { plugins: [i18n] },
    });

    const emptyState = wrapper.get("[data-testid='media-empty-state']");
    await emptyState.trigger("click");

    expect(wrapper.emitted("inspectRequested")).toBeTruthy();
  });

  it("renders empty state as a button for keyboard accessibility", async () => {
    const wrapper = mount(MediaPanel, {
      props: emptyProps,
      global: { plugins: [i18n] },
    });

    const emptyState = wrapper.get("[data-testid='media-empty-state']");
    expect(emptyState.element.tagName).toBe("BUTTON");
    expect(emptyState.attributes("type")).toBe("button");
  });
});
