// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
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
  beforeEach(() => {
    vi.mocked(backend.saveAppSettings)
      .mockReset()
      .mockImplementation(async (settings) => settings);
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
  it("reapplies a saved baseline after an intermediate IPC changes backend state but fails persistence", async () => {
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
    saveMock.mockImplementationOnce((settings) => {
      backendSettings = settings as typeof baseline;
      return new Promise((_resolve, reject) => {
        failChanged = reject;
      });
    });
    const changing = vm.persistNow(changed);
    const reverting = vm.persistNow(baseline);
    await flushPromises();
    expect(backendSettings.queueOutputPolicy.container.format).toBe("mkv");
    failChanged(new Error("atomic replacement denied after state update"));
    await Promise.all([changing, reverting]);
    await flushPromises();
    expect(saveMock.mock.calls.map(([settings]) => settings.queueOutputPolicy?.container)).toEqual([
      { mode: "force", format: "mp4" },
      { mode: "force", format: "mkv" },
      { mode: "force", format: "mp4" },
    ]);
    expect(backendSettings.queueOutputPolicy.container.format).toBe("mp4");
    expect(vm.appSettings.queueOutputPolicy.container.format).toBe("mp4");
    expect(vm.settingsSaveError).toBeNull();
    expect(vm.isSavingSettings).toBe(false);
    wrapper.unmount();
    consoleError.mockRestore();
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
