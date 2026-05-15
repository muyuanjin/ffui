// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import OutputPolicyEditor from "@/components/output/OutputPolicyEditor.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { OutputPolicy } from "@/types";
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
});
