// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    loadAppSettings: vi.fn(),
    saveAppSettings: vi.fn(async (settings: AppSettings) => settings),
    fetchExternalToolStatusesCached: vi.fn(async () => [] as ExternalToolStatus[]),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchExternalToolCandidates: vi.fn(async () => []),
    downloadExternalToolNow: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => {
      return () => {};
    }),
  };
});

import { useAppSettings } from "@/composables/useAppSettings";
import * as backend from "@/lib/backend";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import { acceptSettingsReplacement } from "@/lib/backend.settings";
import { settingsSnapshot } from "./helpers/settingsSnapshot";

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
  },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  defaultQueuePresetId: undefined,
  maxParallelJobs: undefined,
  progressUpdateIntervalMs: undefined,
  metricsIntervalMs: undefined,
  taskbarProgressMode: "byEstimatedTime",
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const TestHost = defineComponent({
  setup() {
    return useAppSettings();
  },
  template: "<div />",
});

describe("useAppSettings.persistNow", () => {
  it("discards queued drafts after import while allowing a new edit with the same value", async () => {
    const initial = makeAppSettings();
    vi.mocked(backend.loadAppSettings).mockResolvedValueOnce(initial);
    let finish!: (settings: AppSettings) => void;
    vi.mocked(backend.saveAppSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    await vm.ensureAppSettingsLoaded();
    const first = vm.updateAppSettings({ locale: "en" });
    await flushPromises();
    const queued = vm.updateAppSettings({ locale: "fr" });
    await flushPromises();
    const imported = { ...initial, locale: "zh-CN" };
    acceptSettingsReplacement(settingsSnapshot(imported));
    expect(vm.appSettings.locale).toBe("zh-CN");
    const fresh = vm.updateAppSettings({ locale: "fr" });
    await flushPromises();
    finish({ ...initial, locale: "en" });
    await Promise.all([first, queued, fresh]);
    await vm.flushSettings();
    expect(backend.saveAppSettings).toHaveBeenCalledTimes(2);
    expect(vm.appSettings.locale).toBe("fr");
    wrapper.unmount();
  });
  it("drains A-B-A writes before flush succeeds and rejects the final failed A write", async () => {
    vi.mocked(backend.loadAppSettings).mockResolvedValueOnce(makeAppSettings());
    const saves: Array<{ resolve: (settings: AppSettings) => void; reject: (error: Error) => void }> = [];
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          saves.push({ resolve, reject });
        }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    await vm.ensureAppSettingsLoaded();
    const policyA = { ...DEFAULT_OUTPUT_POLICY, directory: { mode: "fixed", directory: "D:/A" } };
    const policyB = { ...DEFAULT_OUTPUT_POLICY, directory: { mode: "fixed", directory: "D:/B" } };
    const first = vm.updateAppSettings({ queueOutputPolicy: policyA });
    await flushPromises();
    let result = "pending";
    let failure: unknown;
    const flushing = vm.flushSettings().then(
      () => {
        result = "resolved";
      },
      (error: unknown) => {
        result = "rejected";
        failure = error;
      },
    );
    await flushPromises();
    const changed = vm.updateAppSettings({ queueOutputPolicy: policyB });
    const reverted = vm.updateAppSettings({ queueOutputPolicy: policyA });
    await flushPromises();
    saves[0].resolve(saveMock.mock.calls[0][0]);
    await first;
    await flushPromises();
    expect(result).toBe("pending");
    expect(saveMock).toHaveBeenCalledTimes(2);
    saves[1].resolve(saveMock.mock.calls[1][0]);
    await changed;
    await flushPromises();
    expect(result).toBe("pending");
    expect(saveMock).toHaveBeenCalledTimes(3);
    saves[2].reject(new Error("final A denied"));
    await Promise.all([reverted, flushing]);
    expect(result).toBe("rejected");
    expect(String(failure)).toContain("final A denied");
    wrapper.unmount();
    consoleError.mockRestore();
  });
  it("keeps flush pending after an obsolete save fails until the newer save finishes", async () => {
    let failFirst!: (error: Error) => void;
    let finishSecond!: (settings: AppSettings) => void;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve;
          }),
      );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const first = vm.persistNow({ ...makeAppSettings(), defaultQueuePresetId: "audio" });
    await flushPromises();
    let flushed = false;
    const flushing = vm.flushSettings().then(() => {
      flushed = true;
    });
    await flushPromises();
    const next = vm.updateAppSettings({ defaultQueuePresetId: "image" });
    await flushPromises();
    failFirst(new Error("old save denied"));
    await first;
    await flushPromises();
    expect(flushed).toBe(false);
    expect(vm.isSavingSettings).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(2);
    finishSecond(saveMock.mock.calls[1][0]);
    await Promise.all([next, flushing]);
    expect(flushed).toBe(true);
    wrapper.unmount();
    consoleError.mockRestore();
  });
  it("keeps flush pending when another edit arrives while the earlier save is in flight", async () => {
    const finishes: Array<(settings: AppSettings) => void> = [];
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const first = vm.persistNow({ ...makeAppSettings(), defaultQueuePresetId: "audio" });
    await flushPromises();
    let flushed = false;
    const flushing = vm.flushSettings().then(() => {
      flushed = true;
    });
    await flushPromises();
    const next = vm.updateAppSettings({ defaultQueuePresetId: "image" });
    await flushPromises();
    finishes[0](saveMock.mock.calls[0][0]);
    await first;
    await flushPromises();
    expect(flushed).toBe(false);
    expect(saveMock).toHaveBeenCalledTimes(2);
    finishes[1](saveMock.mock.calls[1][0]);
    await Promise.all([next, flushing]);
    expect(flushed).toBe(true);
    expect(vm.appSettings.defaultQueuePresetId).toBe("image");
    wrapper.unmount();
  });
  beforeEach(() => {
    vi.mocked(backend.loadAppSettings).mockReset();
    vi.mocked(backend.saveAppSettings)
      .mockReset()
      .mockImplementation(async (settings) => settings);
  });
  it("merges concurrent early patches only after the shared load and preserves unrelated settings", async () => {
    let resolveLoad!: (settings: AppSettings) => void;
    vi.mocked(backend.loadAppSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const updates = [
      vm.updateAppSettings({ queuePresetSelection: { mode: "byMedia", audio: "music" } }),
      vm.updateAppSettings({ defaultQueuePresetId: "fallback" }),
      vm.updateAppSettings({ presetSelectionBarPinned: true }),
    ];
    expect(backend.loadAppSettings).toHaveBeenCalledTimes(1);
    expect(vm.appSettings).toBeNull();
    expect(vm.getAppSetting("queuePresetSelection")).toEqual({ mode: "byMedia", audio: "music" });
    expect(vm.getAppSetting("presetSelectionBarPinned")).toBe(true);
    expect(backend.saveAppSettings).not.toHaveBeenCalled();
    resolveLoad({ ...makeAppSettings(), locale: "zh-CN", uiScalePercent: 125 });
    await Promise.all(updates);
    expect(vm.appSettings).toMatchObject({
      queuePresetSelection: { mode: "byMedia", audio: "music" },
      defaultQueuePresetId: "fallback",
      presetSelectionBarPinned: true,
      locale: "zh-CN",
      uiScalePercent: 125,
    });
    expect(backend.saveAppSettings).toHaveBeenLastCalledWith(vm.appSettings);
    wrapper.unmount();
  });

  it("does not replace an unreadable configuration with partial defaults and can retry loading", async () => {
    vi.mocked(backend.loadAppSettings)
      .mockRejectedValueOnce(new Error("unreadable settings"))
      .mockResolvedValueOnce(makeAppSettings());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    await vm.updateAppSettings({ queuePresetSelection: { mode: "byMedia", image: "picture" } });
    expect(vm.settingsSaveError).toContain("unreadable settings");
    expect(vm.appSettings).toBeNull();
    expect(backend.saveAppSettings).not.toHaveBeenCalled();
    await vm.flushSettings();
    expect(vm.settingsSaveError).toBeNull();
    expect(backend.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ queuePresetSelection: { mode: "byMedia", image: "picture" } }),
    );
    wrapper.unmount();
    consoleError.mockRestore();
  });

  it("restores an early default preset edit after hydration and retries failed disk persistence", async () => {
    const selected = ref<string | null>("initial");
    let api!: ReturnType<typeof useAppSettings>;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useAppSettings({ manualJobPresetId: selected });
          return {};
        },
        template: "<div />",
      }),
    );
    vi.mocked(backend.loadAppSettings).mockResolvedValueOnce({ ...makeAppSettings(), defaultQueuePresetId: "saved" });
    vi.mocked(backend.saveAppSettings).mockRejectedValueOnce(new Error("access denied"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await api.updateAppSettings({ defaultQueuePresetId: "early" });
    expect(selected.value).toBe("early");
    expect(api.settingsSaveError.value).toContain("access denied");
    await api.persistNow();
    expect(api.settingsSaveError.value).toBeNull();
    expect(backend.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultQueuePresetId: "early" }),
    );
    wrapper.unmount();
    consoleError.mockRestore();
  });
  it("preserves a unified MP3 setting returned by the versioned backend", async () => {
    const settings = makeAppSettings();
    settings.queueOutputPolicy = { ...DEFAULT_OUTPUT_POLICY, container: { mode: "force", format: "mp3" } };
    vi.mocked(backend.loadAppSettings).mockResolvedValueOnce(settings);
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    await vm.ensureAppSettingsLoaded();
    expect(vm.appSettings.queueOutputPolicy.container).toEqual({ mode: "force", format: "mp3" });
    vm.appSettings.defaultQueuePresetId = "video";
    await vm.persistNow();
    expect(backend.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queueOutputPolicy: expect.objectContaining({ container: { mode: "force", format: "mp3" } }),
      }),
    );
    expect(settings.queueOutputPolicy.container).toEqual({ mode: "force", format: "mp3" });
    wrapper.unmount();
  });
  it("shares an in-flight immediate save with the automatic watcher", async () => {
    let finish!: (settings: AppSettings) => void;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const settings = makeAppSettings();
    settings.defaultQueuePresetId = "audio";
    const saving = vm.persistNow(settings);
    await nextTick();
    await flushPromises();
    await flushPromises();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(vm.isSavingSettings).toBe(true);
    finish(settings);
    await saving;
    expect(vm.isSavingSettings).toBe(false);
    wrapper.unmount();
  });
  it("serializes A-B-A changes and snapshots nested values before awaiting IPC", async () => {
    const finishes: Array<(settings: AppSettings) => void> = [];
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const first = { ...makeAppSettings(), defaultQueuePresetId: "audio" };
    const second = { ...makeAppSettings(), defaultQueuePresetId: "video" };
    const promises = [vm.persistNow(first), vm.persistNow(second), vm.persistNow(first)];
    first.tools.autoUpdate = false;
    await flushPromises();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].tools.autoUpdate).toBe(true);
    for (let index = 0; index < 3; index += 1) {
      expect(saveMock.mock.calls[index][0].defaultQueuePresetId).toBe(index === 1 ? "video" : "audio");
      finishes[index](saveMock.mock.calls[index][0]);
      await promises[index];
    }
    await flushPromises();
    expect(finishes).toHaveLength(4);
    expect(saveMock.mock.calls[3][0].tools.autoUpdate).toBe(false);
    finishes[3](saveMock.mock.calls[3][0]);
    await flushPromises();
    expect(vm.appSettings.defaultQueuePresetId).toBe("audio");
    expect(vm.appSettings.tools.autoUpdate).toBe(false);
    expect(vm.isSavingSettings).toBe(false);
    wrapper.unmount();
  });
  it("does not expose an obsolete save error and allows explicit retry of a failed snapshot", async () => {
    let failFirst!: (error: Error) => void;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const first = vm.persistNow({ ...makeAppSettings(), defaultQueuePresetId: "audio" });
    const second = vm.persistNow({ ...makeAppSettings(), defaultQueuePresetId: "video" });
    await flushPromises();
    failFirst(new Error("obsolete access denied"));
    await Promise.all([first, second]);
    expect(vm.settingsSaveError).toBeNull();
    saveMock.mockRejectedValueOnce(new Error("access denied"));
    const failed = { ...makeAppSettings(), defaultQueuePresetId: "image" };
    await vm.persistNow(failed);
    expect(vm.settingsSaveError).toContain("access denied");
    await vm.persistNow(failed);
    expect(vm.settingsSaveError).toBeNull();
    consoleError.mockRestore();
    wrapper.unmount();
  });
  it("keeps the confirmed baseline after a failed write and can revert without another write", async () => {
    const baseline = {
      ...makeAppSettings(),
      queueOutputPolicy: { ...DEFAULT_OUTPUT_POLICY, container: { mode: "force" as const, format: "mp4" } },
    };
    const changed = {
      ...baseline,
      queueOutputPolicy: { ...DEFAULT_OUTPUT_POLICY, container: { mode: "force" as const, format: "mkv" } },
    };
    let backendSettings = baseline;
    let failChanged!: (error: Error) => void;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockImplementation(async (settings) => {
      backendSettings = settings as typeof baseline;
      return settings;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    await vm.persistNow(baseline);
    await flushPromises();
    saveMock.mockImplementationOnce(() => {
      return new Promise((_resolve, reject) => {
        failChanged = reject;
      });
    });
    const changing = vm.persistNow(changed);
    const reverting = vm.persistNow(baseline);
    await flushPromises();
    expect(backendSettings.queueOutputPolicy.container.format).toBe("mp4");
    failChanged(new Error("atomic replacement denied"));
    await Promise.all([changing, reverting]);
    await flushPromises();
    expect(saveMock.mock.calls.map(([settings]) => settings.queueOutputPolicy?.container)).toEqual([
      { mode: "force", format: "mp4" },
      { mode: "force", format: "mkv" },
    ]);
    expect(backendSettings.queueOutputPolicy.container.format).toBe("mp4");
    expect(vm.appSettings.queueOutputPolicy.container.format).toBe("mp4");
    expect(vm.settingsSaveError).toBeNull();
    expect(vm.isSavingSettings).toBe(false);
    wrapper.unmount();
    consoleError.mockRestore();
  });
  it("adopts backend normalization and merged fields while retaining a later unsaved edit", async () => {
    const initial = makeAppSettings();
    vi.mocked(backend.loadAppSettings).mockResolvedValueOnce(initial);
    let finish!: (settings: AppSettings) => void;
    vi.mocked(backend.saveAppSettings).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    await vm.ensureAppSettingsLoaded();
    const saving = vm.updateAppSettings({ locale: " zh-CN " });
    await flushPromises();
    vm.appSettings.defaultQueuePresetId = "later";
    finish({ ...initial, locale: "zh-CN", maxParallelJobs: 4 });
    await saving;
    expect(vm.appSettings).toMatchObject({ locale: "zh-CN", maxParallelJobs: 4, defaultQueuePresetId: "later" });
    await vm.flushSettings();
    expect(backend.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ locale: "zh-CN", maxParallelJobs: 4, defaultQueuePresetId: "later" }),
    );
    wrapper.unmount();
  });
  it("persists once and keeps the debounced saver from double-writing", async () => {
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockClear();

    await vm.persistNow(makeAppSettings());
    await flushPromises();
    await flushPromises();

    expect(saveMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("markSaved syncs the snapshot so a pending debounced save becomes a no-op", async () => {
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockClear();

    const settings = makeAppSettings();
    vm.appSettings = settings;
    vm.markSaved(settings);
    await flushPromises();
    await flushPromises();

    expect(saveMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
