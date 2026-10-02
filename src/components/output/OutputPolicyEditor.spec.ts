// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import OutputPolicyEditor from "@/components/output/OutputPolicyEditor.vue";
import FormatSelect from "@/components/formats/FormatSelect.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { OutputPolicy, FFmpegPreset } from "@/types";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

const backendMocks = vi.hoisted(() => ({
  previewOutputPath: vi.fn(),
}));

vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  previewOutputPath: backendMocks.previewOutputPath,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeI18n = () =>
  createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: en as any,
      "zh-CN": zhCN as any,
    },
  });

const makePolicy = (container: OutputPolicy["container"]): OutputPolicy => ({
  ...DEFAULT_OUTPUT_POLICY,
  container,
  directory: { mode: "sameAsInput" },
  filename: { ...DEFAULT_OUTPUT_POLICY.filename },
});

describe("OutputPolicyEditor preview", () => {
  it("preserves a unified format selector without converting it to per-output mode", async () => {
    const wrapper = mount(OutputPolicyEditor, {
      props: { modelValue: makePolicy({ mode: "force", format: "mp3" }) },
      global: { plugins: [makeI18n()] },
    });
    expect(wrapper.findAllComponents(FormatSelect)).toHaveLength(1);
    expect(wrapper.findAllComponents(FormatSelect)[0].props("modelValue")).toBe("mp3");
    wrapper.findAllComponents(FormatSelect)[0].vm.$emit("update:modelValue", "flac");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]?.[0]).toMatchObject({
      container: { mode: "force", format: "flac" },
    });
    expect(wrapper.get('[data-testid="output-policy-container-mode-trigger"]').text()).toBe("Unified format");
    wrapper.unmount();
  });
  it("previews video extraction with the actual per-input audio preset", async () => {
    const presets = [
      { id: "video", container: { format: "mp4" } },
      { id: "audio", advancedEnabled: true, ffmpegTemplate: "ffmpeg -i INPUT -vn -c:a libmp3lame -f mp3 OUTPUT" },
    ] as FFmpegPreset[];
    backendMocks.previewOutputPath.mockResolvedValue(null);
    const wrapper = mount(OutputPolicyEditor, {
      props: {
        modelValue: makePolicy({ mode: "byMedia", video: "mkv", audio: "mp3" }),
        previewPresets: presets,
        previewUnifiedPresetId: "video",
        previewPresetSelection: { mode: "byMedia", video: "audio" },
      },
      global: { plugins: [makeI18n()] },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(backendMocks.previewOutputPath).toHaveBeenLastCalledWith(expect.objectContaining({ presetId: "audio" }));
    expect(wrapper.get('[data-testid="output-policy-preview-output"]').text()).toContain(".mp3");
    await wrapper.get('[data-testid="output-policy-preview-input"]').setValue("C:/media/track.wav");
    await vi.advanceTimersByTimeAsync(250);
    expect(backendMocks.previewOutputPath).toHaveBeenLastCalledWith(
      expect.objectContaining({ presetId: "video", inputPath: "C:/media/track.wav" }),
    );
    wrapper.unmount();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    backendMocks.previewOutputPath.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores stale backend preview responses after the forced container changes", async () => {
    const pending: Array<Deferred<string | null>> = [];
    backendMocks.previewOutputPath.mockImplementation(() => {
      const deferred = createDeferred<string | null>();
      pending.push(deferred);
      return deferred.promise;
    });

    const wrapper = mount(OutputPolicyEditor, {
      props: {
        modelValue: makePolicy({ mode: "default" }),
        previewPresetId: "preset-1",
      },
      global: { plugins: [makeI18n()] },
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(pending).toHaveLength(1);

    await wrapper.setProps({
      modelValue: makePolicy({ mode: "force", format: "mkv" }),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(pending).toHaveLength(2);

    const previewOutput = () => wrapper.get('[data-testid="output-policy-preview-output"]').text();
    expect(previewOutput()).toContain("input.compressed.mkv");

    pending[1].resolve("C:/videos/input.compressed.mkv");
    await flushPromises();
    expect(previewOutput()).toContain("input.compressed.mkv");

    pending[0].resolve("C:/videos/input.compressed.mp4");
    await flushPromises();

    expect(previewOutput()).toContain("input.compressed.mkv");
    expect(previewOutput()).not.toContain("input.compressed.mp4");
  });

  it("clears the pending preview indicator when a routed preset disappears and ignores the old response", async () => {
    const pending = createDeferred<string | null>();
    backendMocks.previewOutputPath.mockReturnValue(pending.promise);
    const wrapper = mount(OutputPolicyEditor, {
      props: {
        modelValue: makePolicy({ mode: "default" }),
        previewPresets: [{ id: "video" }] as FFmpegPreset[],
        previewUnifiedPresetId: "video",
        previewPresetSelection: { mode: "byMedia", video: "video" },
      },
      global: { plugins: [makeI18n()] },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.text()).toContain(en.outputPolicy.preview.loading);
    await wrapper.setProps({ previewPresetSelection: { mode: "byMedia", video: "deleted" } });
    await vi.advanceTimersByTimeAsync(250);
    expect(wrapper.text()).toContain("deleted");
    expect(wrapper.text()).not.toContain(en.outputPolicy.preview.loading);
    pending.resolve("C:/videos/stale.mp4");
    await flushPromises();
    expect(wrapper.text()).toContain("deleted");
    expect(wrapper.text()).not.toContain(en.outputPolicy.preview.loading);
    expect(wrapper.get('[data-testid="output-policy-preview-output"]').text()).not.toContain("stale.mp4");
    expect(backendMocks.previewOutputPath).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it.each(["mp3", "m4a", "aac", "png"])(
    "emits the selected %s output policy and updates localized guidance",
    async (format) => {
      const i18n = makeI18n();
      const wrapper = mount(OutputPolicyEditor, {
        props: { modelValue: makePolicy({ mode: "byMedia", video: "mp4" }) },
        global: { plugins: [i18n] },
      });
      const kind = format === "png" ? "image" : "audio";
      const selector = wrapper.get(`[data-testid="output-policy-${kind}-format"]`).getComponent(FormatSelect);
      expect(selector.props("allowedKinds")).toEqual([kind]);
      expect(selector.props("entries")).toContainEqual(expect.objectContaining({ value: format }));
      selector.vm.$emit("update:modelValue", format);
      expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]?.[0]).toEqual(
        expect.objectContaining({ container: { mode: "byMedia", video: "mp4", [kind]: format } }),
      );
      expect(wrapper.get('[data-testid="output-policy-format-help"]').text()).toContain("target output type");
      i18n.global.locale.value = "zh-CN";
      await flushPromises();
      expect(wrapper.get('[data-testid="output-policy-format-help"]').text()).toContain("目标输出类型");
      expect(wrapper.get('[data-testid="output-policy-container-mode-trigger"]').text()).toContain(
        "按输出类型指定格式",
      );
      wrapper.unmount();
    },
  );

  it("keeps three independent formats and clears one selection to follow the preset", async () => {
    const wrapper = mount(OutputPolicyEditor, {
      props: { modelValue: makePolicy({ mode: "byMedia", video: "mkv", audio: "mp3", image: "png" }) },
      global: { plugins: [makeI18n()] },
    });
    expect(wrapper.findAllComponents(FormatSelect)).toHaveLength(3);
    wrapper
      .get('[data-testid="output-policy-audio-format"]')
      .getComponent(FormatSelect)
      .vm.$emit("update:modelValue", "__preset__");
    expect(wrapper.emitted("update:modelValue")?.slice(-1)[0]?.[0]).toMatchObject({
      container: { mode: "byMedia", video: "mkv", audio: undefined, image: "png" },
    });
    await wrapper.setProps({ modelValue: makePolicy({ mode: "default" }) });
    expect(wrapper.findAllComponents(FormatSelect)).toHaveLength(0);
    wrapper.unmount();
  });
});
