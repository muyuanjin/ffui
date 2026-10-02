// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NativeMediaPreview from "./NativeMediaPreview.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

const backend = vi.hoisted(() => ({ prepare: vi.fn(), data: vi.fn(), tauri: true }));
vi.mock("@/lib/backend", () => ({
  hasTauri: () => backend.tauri,
  buildPreviewUrl: (path: string) => `asset:${path}`,
  loadPreviewDataUrl: backend.data,
  prepareNativeMediaPreview: backend.prepare,
}));
const createPreview = (kind: "audio" | "image" = "audio") => {
  const i18n = createI18n({ legacy: false, locale: "zh-CN", messages: { en, "zh-CN": zhCN } });
  const wrapper = mount(NativeMediaPreview, {
    props: { kind, nativeUrl: "asset:C:/源.mkv", sourcePath: "C:/源.mkv" },
    global: { plugins: [i18n] },
  });
  return { wrapper, i18n };
};

describe("native audio and image previews", () => {
  beforeEach(() => {
    backend.prepare.mockReset();
    backend.data.mockReset();
    backend.tauri = true;
  });
  it("plays audio with visible controls without video dimensions or frame requests", async () => {
    const { wrapper } = createPreview();
    expect(wrapper.find("video").exists()).toBe(false);
    const audio = wrapper.get("audio");
    expect(audio.attributes()).toMatchObject({ controls: "", autoplay: "" });
    await audio.trigger("loadedmetadata");
    expect(backend.prepare).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("pauses playing audio on source change and unmount", async () => {
    const { wrapper } = createPreview();
    const first = wrapper.get("audio").element as HTMLAudioElement;
    Object.defineProperty(first, "paused", { value: false, configurable: true });
    const pauseFirst = vi.spyOn(first, "pause").mockImplementation(() => {});
    await wrapper.setProps({ nativeUrl: "asset:new.mp3", sourcePath: "new.mp3" });
    expect(pauseFirst).toHaveBeenCalledTimes(1);
    const second = wrapper.get("audio").element as HTMLAudioElement;
    Object.defineProperty(second, "paused", { value: false, configurable: true });
    const pauseSecond = vi.spyOn(second, "pause").mockImplementation(() => {});
    wrapper.unmount();
    expect(pauseSecond).toHaveBeenCalledTimes(1);
  });
  it("prepares and plays an audio copy from the same selected source", async () => {
    const { wrapper } = createPreview();
    backend.prepare.mockResolvedValue("C:/cache/audio.m4a");
    await wrapper.get("audio").trigger("error");
    await flushPromises();
    expect(backend.prepare).toHaveBeenCalledWith("C:/源.mkv", "audio");
    expect(wrapper.get("audio").attributes("src")).toBe("asset:C:/cache/audio.m4a");
    expect(wrapper.get('[data-testid="media-preview-compatible"]').text()).toContain("原文件未修改");
    await wrapper.get("audio").trigger("error");
    expect(wrapper.get('[role="alert"]').text()).toContain("无法播放此音频");
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    await wrapper.findAll("button")[0]!.trigger("click");
    expect(wrapper.emitted("openInSystemPlayer")).toHaveLength(1);
    wrapper.unmount();
  });
  it("views images natively and converts unsupported images without seeking", async () => {
    const { wrapper } = createPreview("image");
    expect(wrapper.find("video").exists()).toBe(false);
    expect(wrapper.find("audio").exists()).toBe(false);
    backend.prepare.mockResolvedValue("C:/cache/image.png");
    await wrapper.get("img").trigger("error");
    await flushPromises();
    expect(backend.prepare).toHaveBeenCalledWith("C:/源.mkv", "image");
    expect(wrapper.get("img").attributes("src")).toBe("asset:C:/cache/image.png");
    backend.data.mockResolvedValue("data:image/png;base64,valid");
    await wrapper.get("img").trigger("error");
    await flushPromises();
    expect(backend.data).toHaveBeenCalledWith("C:/cache/image.png");
    expect(wrapper.get("img").attributes("src")).toBe("data:image/png;base64,valid");
    await wrapper.get("img").trigger("error");
    expect(wrapper.get('[role="alert"]').text()).toContain("无法显示此图片");
    wrapper.unmount();
  });
  it("shows preparation and ignores a stale conversion after changing source", async () => {
    const { wrapper } = createPreview();
    let complete!: (path: string) => void;
    backend.prepare.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    await wrapper.get("audio").trigger("error");
    expect(wrapper.get('[role="status"]').text()).toContain("正在生成兼容预览");
    await wrapper.setProps({ nativeUrl: "asset:new.mp3", sourcePath: "new.mp3" });
    complete("old.m4a");
    await flushPromises();
    expect(wrapper.get("audio").attributes("src")).toBe("asset:new.mp3");
    expect(wrapper.find('[data-testid="media-preview-compatible"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it("shows conversion diagnostics and updates error text on locale switching", async () => {
    const { wrapper, i18n } = createPreview();
    backend.prepare.mockRejectedValue(new Error("unsupported codec"));
    await wrapper.get("audio").trigger("error");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("unsupported codec");
    i18n.global.locale.value = "en";
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Unable to prepare a compatible preview");
    expect(wrapper.findAll("button")[0]!.text()).toContain("Open in system player");
    wrapper.unmount();
  });
});
